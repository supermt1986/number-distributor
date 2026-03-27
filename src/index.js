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

  async getAndIncrement() {
    try {
      let current = await this.state.storage.get("counter");
      current = current !== null ? parseInt(current) : 0;
      if (isNaN(current)) current = 0;
      
      const next = current >= 99 ? 0 : current + 1;
      await this.state.storage.put("counter", next.toString());
      
      return { current, next };
    } catch (error) {
      console.error("Error in getAndIncrement:", error);
      throw error;
    }
  }

  async getCurrent() {
    try {
      let value = await this.state.storage.get("counter");
      let result = value !== null ? parseInt(value) : 0;
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.error("Error in getCurrent:", error);
      return 0;
    }
  }

  async reset(targetValue = 0) {
    try {
      let previous = await this.getCurrent();
      let target = Math.max(0, Math.min(99, parseInt(targetValue)));
      
      await this.state.storage.put("counter", target.toString());
      return { success: true, value: target, previous };
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
      } else {
        return new Response(
          JSON.stringify({ error: "Not found", paths: ["/get", "/current", "/reset"] }),
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
    
    const result = {
      success: true,
      number: data.current,
      next_available: data.next,
      total_pool: 100,
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
    
    const response = await obj.fetch(
      new Request("http://placeholder/current", { method: "GET" })
    );
    const data = await response.json();
    
    const result = {
      current_number: data.current,
      range: "0-99",
      total_pool: 100,
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

  async getAndIncrement() {
    try {
      let current = await this.state.storage.get("counter");
      current = current !== null ? parseInt(current) : 0;
      if (isNaN(current)) current = 0;
      
      const next = current >= 4 ? 0 : current + 1;
      await this.state.storage.put("counter", next.toString());
      
      return { current, next };
    } catch (error) {
      console.error("[DO2] Error in getAndIncrement:", error);
      throw error;
    }
  }

  async getCurrent() {
    try {
      let value = await this.state.storage.get("counter");
      let result = value !== null ? parseInt(value) : 0;
      return isNaN(result) ? 0 : result;
    } catch (error) {
      console.error("[DO2] Error in getCurrent:", error);
      return 0;
    }
  }

  async reset(targetValue = 0) {
    try {
      let previous = await this.getCurrent();
      let target = Math.max(0, Math.min(4, parseInt(targetValue)));
      
      await this.state.storage.put("counter", target.toString());
      return { success: true, value: target, previous };
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
      } else {
        return new Response(
          JSON.stringify({ error: "Not found", paths: ["/get", "/current", "/reset"] }),
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
      total_pool: 5,
      range: "0-4",
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
      range: "0-4",
      total_pool: 5,
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
      range: "0-4",
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
    
    // NEW: Second pool (0-4) - Temporarily disabled until DO2 migration complete
    if (url.pathname === "/api/distribute2" || 
        url.pathname === "/api/number2" || 
        url.pathname === "/api/current2" || 
        url.pathname === "/api/reset2") {
      return new Response(
        JSON.stringify({ 
          error: "Service temporarily unavailable", 
          message: "Pool 2 (distribute2) is being configured. Please use /api/distribute for now." 
        }),
        { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } }
      );
    }
    
    // 404
    return new Response(
      JSON.stringify({
        error: "Not found",
        available_paths: [
          "/", "/health",
          "/api/distribute", "/api/number", "/api/current", "/api/reset"
        ]
      }),
      { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } }
    );
  }
};
