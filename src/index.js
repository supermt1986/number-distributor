/**
 * Number Distributor - Cloudflare Worker with Durable Objects
 * 
 * Original version distributes numbers from pool 0-99
 * Extended version adds distribute2 for pool 0-4
 */

// ==================== Durable Object: NumberDistributor ====================

export class NumberDistributor {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // 🔐 获取当前配置（向后兼容：如果不存在则使用默认值）
  async getConfig() {
    let config = await this.state.storage.get("config");
    if (!config || typeof config.min === "undefined" || typeof config.max === "undefined") {
      // 首次运行或升级：自动初始化，但不影响已有的 counter
      config = { min: 0, max: 89 };
      await this.state.storage.put("config", config);
    }
    return config;
  }

  // 🔧 更新配置（安全的：不影响 counter）
  async configurePool(min, max) {
    try {
      // 安全校验
      min = Math.max(0, parseInt(min) || 0);
      max = Math.max(min, parseInt(max) || min);
      
      // 读取当前 counter 值进行检查
      let current = await this.state.storage.get("counter");
      current = current !== null ? parseInt(current) : 0;
      if (isNaN(current)) current = 0;
      
      // 安全检查：如果当前值超出新范围，拒绝更改
      if (current > max) {
        return {
          success: false,
          error: `Cannot shrink range: current value ${current} exceeds new max ${max}`
        };
      }
      
      // 保存新配置（只写 config 键，不影响 counter）
      const oldConfig = await this.getConfig();
      await this.state.storage.put("config", { min, max });
      
      return {
        success: true,
        previous: oldConfig,
        new: { min, max },
        current_value: current
      };
    } catch (error) {
      console.error("Error in configurePool:", error);
      return { success: false, error: error.message };
    }
  }

  async getAndIncrement() {
    try {
      let current = await this.state.storage.get("counter");
      current = current !== null ? parseInt(current) : 0;
      if (isNaN(current)) current = 0;
      
      // 使用动态配置而不是硬编码
      const config = await this.getConfig();
      const next = current >= config.max ? config.min : current + 1;
      await this.state.storage.put("counter", next.toString());
      
      return { current, next, range: `${config.min}-${config.max}` };
    } catch (error) {
      console.error("Error in getAndIncrement:", error);
      throw error;
    }
  }

  async getCurrent() {
    try {
      let value = await this.state.storage.get("counter");
      let result = value !== null ? parseInt(value) : 0;
      if (isNaN(result)) result = 0;
      return result;  // 只返回数字（向后兼容）
    } catch (error) {
      console.error("Error in getCurrent:", error);
      return 0;
    }
  }

  async reset(targetValue = 0) {
    try {
      let previous = await this.getCurrent();
      const config = await this.getConfig();
      // 使用动态配置的边界
      let target = Math.max(config.min, Math.min(config.max, parseInt(targetValue)));
      
      await this.state.storage.put("counter", target.toString());
      return { success: true, value: target, previous, range: `${config.min}-${config.max}` };
    } catch (error) {
      console.error("Error in reset:", error);
      return { success: false, error: error.message };
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      if (url.pathname.endsWith("/get")) {
        const result = await this.getAndIncrement();
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/current")) {
        const current = await this.getCurrent();
        return new Response(JSON.stringify({ current }), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/reset")) {
        let targetValue = 0;
        if (request.method === "POST") {
          try {
            const body = await request.json();
            targetValue = parseInt(body.value) || 0;
          } catch {}
        }
        const result = await this.reset(targetValue);
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/configure")) {
        // 🔧 Pool 1: 更新配置 (primary pool)
        if (request.method !== "POST") {
          return new Response(
            JSON.stringify({ error: "Method not allowed", method: "POST required" }),
            { status: 405, headers: { ...headers, "Content-Type": "application/json" } }
          );
        }
        let min = 0, max = 89;
        try {
          const body = await request.json();
          min = parseInt(body.min) ?? 0;
          max = parseInt(body.max) ?? 89;
        } catch {}
        const result = await this.configurePool(min, max);
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" },
          status: result.success ? 200 : 400
        });
      } else if (url.pathname.endsWith("/config")) {
        // 📊 Pool 1: 查询配置
        const config = await this.getConfig();
        return new Response(JSON.stringify({ config, pool: "primary" }), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else {
        return new Response(
          JSON.stringify({ error: "Not found", paths: ["/get", "/current", "/reset", "/configure", "/config"] }),
          { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
}

// ==================== Worker Handler ====================

const API_TOKEN = "sk-fCIHbAWDMPBb36cv6OShwOxlEMeZKh--0Bl4qqnxD_k";

// Helper: check auth
function checkAuth(headers) {
  const auth = headers.get("Authorization");
  const token = headers.get("X-API-Token");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7) === API_TOKEN;
  }
  return token === API_TOKEN;
}

// Helper: handle CORS
function corsHeaders(methods = "GET, POST, OPTIONS") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type, X-API-Token"
  };
}

// Endpoint: /health and /
async function handleHealth(request) {
  const info = {
    service: "number-distributor",
    status: "healthy",
    pool_size: 100,
    range: "0-99",
    storage_backend: "durable_objects",
    timestamp: new Date().toISOString()
  };
  return new Response(JSON.stringify(info, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

// Endpoint: /api/distribute or /api/number
async function handleDistribute(request, env) {
  const headers = {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8"
  };

  if (!checkAuth(request.headers)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized", message: "Invalid or missing API token" }),
      { status: 401, headers }
    );
  }

  try {
    const objId = env.NUMBER_DISTRIBUTOR.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR.get(objId);
    
    // Call DO to get next number
    const response = await obj.fetch(
      new Request("http://placeholder/get", { method: "GET" })
    );
    const data = await response.json();
    
    // Calculate dynamic pool size from config
    const poolSize = (data.range ? parseInt(data.range.split('-')[1]) - parseInt(data.range.split('-')[0]) + 1 : 90);
    
    const result = {
      success: true,
      number: data.current,
      next_available: data.next,
      total_pool: poolSize,
      range: data.range || "0-89",
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", message: error.message }),
      { status: 500, headers }
    );
  }
}

// Endpoint: /api/current
async function handleCurrent(request, env) {
  const headers = {
    ...corsHeaders("GET, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const objId = env.NUMBER_DISTRIBUTOR.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR.get(objId);
    
    // Get current number from DO
    const response1 = await obj.fetch(
      new Request("http://placeholder/current", { method: "GET" })
    );
    const data = await response1.json();
    
    // Get config from DO to get the dynamic range
    const response2 = await obj.fetch(
      new Request("http://placeholder/config", { method: "GET" })
    );
    const configData = await response2.json();
    
    // Extract just the number value (handle nested format from getCurrent)
    const currentNumber = (typeof data === 'object' && data.current !== undefined) ? data.current : data;
    const range = configData.config ? `${configData.config.min}-${configData.config.max}` : "0-89";
    const poolSize = configData.config ? configData.config.max - configData.config.min + 1 : 90;
    
    const result = {
      current_number: currentNumber,
      range: range,
      total_pool: poolSize,
      storage_type: "durable_objects",
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to get current state", message: error.message }),
      { status: 500, headers }
    );
  }
}

// Endpoint: /api/reset
async function handleReset(request, env) {
  const headers = {
    ...corsHeaders("POST, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (!checkAuth(request.headers)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized", message: "Invalid or missing API token" }),
      { status: 401, headers }
    );
  }

  try {
    let targetValue = 0;
    try {
      const body = await request.json();
      targetValue = parseInt(body.value) || 0;
    } catch {}

    const objId = env.NUMBER_DISTRIBUTOR.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR.get(objId);
    
    const response = await obj.fetch(
      new Request("http://placeholder/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: targetValue })
      })
    );
    const data = await response.json();
    
    const result = {
      success: data.success,
      previous_value: data.previous,
      new_value: data.value,
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to reset counter", message: error.message }),
      { status: 500, headers }
    );
  }
}

// ==================== NEW: Second Pool (0-4) ====================

// Durable Object for second pool
export class NumberDistributor2 {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  // 🔐 获取当前配置（向后兼容：如果不存在则使用默认值）
  async getConfig() {
    let config = await this.state.storage.get("config");
    if (!config || typeof config.min === "undefined" || typeof config.max === "undefined") {
      // 首次运行或升级：自动初始化，但不影响已有的 counter
      config = { min: 90, max: 99 };
      await this.state.storage.put("config", config);
    }
    return config;
  }

  // 🔧 更新配置（安全的：不影响 counter）
  async configurePool(min, max) {
    try {
      // 安全校验
      min = Math.max(90, parseInt(min) || 90);  // 最小值不能低于 90
      max = Math.max(min, parseInt(max) || min);
      
      // 读取当前 counter 值进行检查
      let currentInternal = await this.state.storage.get("counter");
      currentInternal = currentInternal !== null ? parseInt(currentInternal) : 0;
      if (isNaN(currentInternal)) currentInternal = 0;
      const currentDisplay = currentInternal + 90;  // 转换为显示值
      
      // 安全检查：如果当前值超出新范围，拒绝更改
      if (currentDisplay > max) {
        return {
          success: false,
          error: `Cannot shrink range: current value ${currentDisplay} exceeds new max ${max}`
        };
      }
      
      // 保存新配置（只写 config 键，不影响 counter）
      const oldConfig = await this.getConfig();
      await this.state.storage.put("config", { min, max });
      
      return {
        success: true,
        previous: oldConfig,
        new: { min, max },
        current_value: currentDisplay
      };
    } catch (error) {
      console.error("Error in configurePool:", error);
      return { success: false, error: error.message };
    }
  }

  async getAndIncrement() {
    try {
      let current = await this.state.storage.get("counter");
      current = current !== null ? parseInt(current) : 0;
      if (isNaN(current)) current = 0;
      
      // 使用动态配置而不是硬编码
      const config = await this.getConfig();
      const nextInternal = current >= (config.max - 90) ? 0 : current + 1;
      await this.state.storage.put("counter", nextInternal.toString());
      
      return { 
        current: current + 90, 
        next: nextInternal + 90,
        range: `${config.min}-${config.max}` 
      };
    } catch (error) {
      console.error("[DO2] Error in getAndIncrement:", error);
      throw error;
    }
  }

  async getCurrent() {
    try {
      let value = await this.state.storage.get("counter");
      let result = value !== null ? parseInt(value) : 0;
      result = isNaN(result) ? 0 : result;
      // Return display value (internal + 90)
      return result + 90;
    } catch (error) {
      console.error("[DO2] Error in getCurrent:", error);
      return 90;
    }
  }

  async reset(targetValue = 90) {
    try {
      let previous = await this.getCurrent();
      const config = await this.getConfig();
      // Accept display value (min-max), use config bounds
      let target = Math.max(config.min, Math.min(config.max, parseInt(targetValue)));
      
      // Store internal value (display - 90)
      await this.state.storage.put("counter", (target - 90).toString());
      return { success: true, value: target, previous, range: `${config.min}-${config.max}` };
    } catch (error) {
      console.error("[DO2] Error in reset:", error);
      return { success: false, error: error.message };
    }
  }

  async fetch(request) {
    const url = new URL(request.url);
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }

    try {
      if (url.pathname.endsWith("/get")) {
        const result = await this.getAndIncrement();
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/current")) {
        const current = await this.getCurrent();
        return new Response(JSON.stringify({ current }), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/reset")) {
        let targetValue = 0;
        if (request.method === "POST") {
          try {
            const body = await request.json();
            targetValue = parseInt(body.value) || 0;
          } catch {}
        }
        const result = await this.reset(targetValue);
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else if (url.pathname.endsWith("/configure")) {
        // 🔧 Pool 2: 更新配置
        if (request.method !== "POST") {
          return new Response(
            JSON.stringify({ error: "Method not allowed", method: "POST required" }),
            { status: 405, headers: { ...headers, "Content-Type": "application/json" } }
          );
        }
        let min = 90, max = 99;
        try {
          const body = await request.json();
          min = parseInt(body.min) ?? 90;
          max = parseInt(body.max) ?? 99;
        } catch {}
        const result = await this.configurePool(min, max);
        return new Response(JSON.stringify(result), {
          headers: { ...headers, "Content-Type": "application/json" },
          status: result.success ? 200 : 400
        });
      } else if (url.pathname.endsWith("/config")) {
        // 📊 Pool 2: 查询配置
        const config = await this.getConfig();
        return new Response(JSON.stringify({ config, pool: "secondary" }), {
          headers: { ...headers, "Content-Type": "application/json" }
        });
      } else {
        return new Response(
          JSON.stringify({ error: "Not found", paths: ["/get", "/current", "/reset", "/configure", "/config"] }),
          { status: 404, headers: { ...headers, "Content-Type": "application/json" } }
        );
      }
    } catch (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...headers, "Content-Type": "application/json" } }
      );
    }
  }
}

// New endpoints for second pool
async function handleDistribute2(request, env) {
  const headers = {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8"
  };

  if (!checkAuth(request.headers)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized", message: "Invalid or missing API token" }),
      { status: 401, headers }
    );
  }

  try {
    const objId = env.NUMBER_DISTRIBUTOR2.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR2.get(objId);
    
    const response = await obj.fetch(
      new Request("http://placeholder/get", { method: "GET" })
    );
    const data = await response.json();
    
    const result = {
      success: true,
      number: data.current,
      next_available: data.next,
      total_pool: 10,
      range: "90-99",
      pool_name: "distribute2",
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Internal server error", message: error.message }),
      { status: 500, headers }
    );
  }
}

async function handleCurrent2(request, env) {
  const headers = {
    ...corsHeaders("GET, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const objId = env.NUMBER_DISTRIBUTOR2.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR2.get(objId);
    
    const response = await obj.fetch(
      new Request("http://placeholder/current", { method: "GET" })
    );
    const data = await response.json();
    
    const result = {
      current_number: data.current,
      range: "90-99",
      total_pool: 10,
      storage_type: "durable_objects",
      pool_name: "distribute2",
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to get current state", message: error.message }),
      { status: 500, headers }
    );
  }
}

async function handleReset2(request, env) {
  const headers = {
    ...corsHeaders("POST, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (!checkAuth(request.headers)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized", message: "Invalid or missing API token" }),
      { status: 401, headers }
    );
  }

  try {
    let targetValue = 0;
    try {
      const body = await request.json();
      targetValue = parseInt(body.value) || 0;
    } catch {}

    const objId = env.NUMBER_DISTRIBUTOR2.idFromName("default");
    const obj = await env.NUMBER_DISTRIBUTOR2.get(objId);
    
    const response = await obj.fetch(
      new Request("http://placeholder/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: targetValue })
      })
    );
    const data = await response.json();
    
    const result = {
      success: data.success,
      previous_value: data.previous,
      new_value: data.value,
      pool_name: "distribute2",
      range: "90-99",
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to reset counter", message: error.message }),
      { status: 500, headers }
    );
  }
}

// ==================== NEW: Pool Configuration APIs ====================

// 📊 GET /api/pool-config?pool=primary|secondary
async function handleGetPoolConfig(request, env) {
  const headers = {
    ...corsHeaders("GET, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  try {
    const url = new URL(request.url);
    const pool = url.searchParams.get("pool") || "primary";
    
    let objId, obj;  
    if (pool === "primary") {
      objId = env.NUMBER_DISTRIBUTOR.idFromName("default");
      obj = await env.NUMBER_DISTRIBUTOR.get(objId);
    } else if (pool === "secondary") {
      objId = env.NUMBER_DISTRIBUTOR2.idFromName("default");
      obj = await env.NUMBER_DISTRIBUTOR2.get(objId);
    } else {
      return new Response(
        JSON.stringify({ error: "Invalid pool", valid: ["primary", "secondary"] }),
        { status: 400, headers }
      );
    }
    
    const response = await obj.fetch(
      new Request("http://placeholder/config", { method: "GET" })
    );
    const data = await response.json();
    
    return new Response(JSON.stringify(data, null, 2), { status: 200, headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Failed to get config", message: error.message }),
      { status: 500, headers }
    );
  }
}

// 🔧 POST /api/configure-pool
async function handleConfigurePool(request, env) {
  const headers = {
    ...corsHeaders("POST, OPTIONS"),
    "Content-Type": "application/json"
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  if (!checkAuth(request.headers)) {
    return new Response(
      JSON.stringify({ success: false, error: "Unauthorized", message: "Invalid or missing API token" }),
      { status: 401, headers }
    );
  }

  try {
    let pool = "primary";
    let min = 0, max = 89;
    
    try {
      const body = await request.json();
      pool = body.pool || "primary";
      min = body.min ?? 0;
      max = body.max ?? 89;
    } catch {}
    
    // Validate pool
    if (pool !== "primary" && pool !== "secondary") {
      return new Response(
        JSON.stringify({ error: "Invalid pool", valid: ["primary", "secondary"] }),
        { status: 400, headers }
      );
    }
    
    let objId, obj;
    if (pool === "primary") {
      objId = env.NUMBER_DISTRIBUTOR.idFromName("default");
      obj = await env.NUMBER_DISTRIBUTOR.get(objId);
    } else {
      objId = env.NUMBER_DISTRIBUTOR2.idFromName("default");
      obj = await env.NUMBER_DISTRIBUTOR2.get(objId);
    }
    
    const response = await obj.fetch(
      new Request("http://placeholder/configure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min, max })
      })
    );
    const data = await response.json();
    
    const result = {
      success: data.success,
      pool,
      previous_range: data.previous ? `${data.previous.min}-${data.previous.max}` : null,
      new_range: data.new ? `${data.new.min}-${data.new.max}` : null,
      current_value: data.current_value,
      timestamp: new Date().toISOString()
    };
    
    return new Response(JSON.stringify(result, null, 2), {
      status: data.success ? 200 : 400,
      headers
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: "Failed to configure pool", message: error.message }),
      { status: 500, headers }
    );
  }
}

// ==================== Main Router ====================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Health check
    if (url.pathname === "/" || url.pathname === "/health") {
      return handleHealth(request);
    }
    
    // Original pool (0-99)
    if (url.pathname === "/api/distribute" || url.pathname === "/api/number") {
      return handleDistribute(request, env);
    }
    if (url.pathname === "/api/current") {
      return handleCurrent(request, env);
    }
    if (url.pathname === "/api/reset") {
      return handleReset(request, env);
    }
    
    // NEW: Second pool (0-4) - ENABLED!
    if (url.pathname === "/api/distribute2" || 
        url.pathname === "/api/number2") {
      return handleDistribute2(request, env);
    }
    if (url.pathname === "/api/current2") {
      return handleCurrent2(request, env);
    }
    if (url.pathname === "/api/reset2") {
      return handleReset2(request, env);
    }
    
    // 🔧 NEW: Pool Configuration APIs
    if (url.pathname === "/api/pool-config") {
      return handleGetPoolConfig(request, env);
    }
    if (url.pathname === "/api/configure-pool") {
      return handleConfigurePool(request, env);
    }
    
    // 404
    return new Response(
      JSON.stringify({
        error: "Not found",
        available_paths: [
          "/", "/health",
          "/api/distribute", "/api/number", "/api/current", "/api/reset",
          "/api/distribute2", "/api/number2", "/api/current2", "/api/reset2",
          "/api/pool-config", "/api/configure-pool"
        ]
      }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
