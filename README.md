# Number Distributor - Cloudflare Worker

A distributed number allocation service using Cloudflare Durable Objects.

## Features

- **Dynamic Pool Configuration**: Update number pool ranges without data loss! 🔧
- **Pool 1 (Primary)**: Configurable range, default 0-99 (100 numbers)
- **Pool 2 (Secondary)**: Configurable range, default 90-99 (10 numbers)

## API Endpoints

### Health & Info

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Service info | ❌ No |
| GET | `/health` | Health check | ❌ No |

### Pool 1 (Primary - Default 0-99)

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/current` | Get current number | ❌ No |
| POST | `/api/distribute` | Get next number | ✅ Yes |
| POST | `/api/number` | Alias for distribute | ✅ Yes |
| POST | `/api/reset` | Reset counter | ✅ Yes |

### Pool 2 (0-4) - NEW!

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/api/current2` | Get current number | ❌ No |
| POST | `/api/distribute2` | Get next number | ✅ Yes |
| POST | `/api/number2` | Alias for distribute2 | ✅ Yes |
| POST | `/api/reset2` | Reset counter | ✅ Yes |

## Usage Examples

### Get Current Number (No Auth)
```bash
curl https://number-distributor.wangjunli1983.workers.dev/api/current
```

Response:
```json
{
  "current_number": 29,
  "range": "0-99",
  "total_pool": 100,
  "storage_type": "durable_objects",
  "timestamp": "2026-03-27T14:25:40.393Z"
}
```

### Distribute Next Number (Auth Required)
```bash
curl -X POST https://number-distributor.wangjunli1983.workers.dev/api/distribute \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

Response:
```json
{
  "success": true,
  "number": 29,
  "next_available": 30,
  "total_pool": 100,
  "timestamp": "2026-03-27T14:25:40.393Z"
}
```

### Use Pool 2 (0-4)
```bash
curl -X POST https://number-distributor.wangjunli1983.workers.dev/api/distribute2 \
  -H "Authorization: Bearer YOUR_API_TOKEN"
```

Response:
```json
{
  "success": true,
  "number": 2,
  "next_available": 3,
  "total_pool": 5,
  "range": "0-4",
  "pool_name": "distribute2",
  "timestamp": "2026-03-27T14:25:40.393Z"
}
```

### Configure Pool Range 🔧 NEW!
**Query Current Configuration:**
```bash
curl https://number-distributor.wangjunli1983.workers.dev/api/pool-config?pool=primary
```

Response:
```json
{
  "config": {
    "min": 0,
    "max": 99
  },
  "pool": "primary"
}
```

**Update Pool Range:**
```bash
curl -X POST https://number-distributor.wangjunli1983.workers.dev/api/configure-pool \
  -H "X-API-Token: YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pool": "primary", "min": 0, "max": 99}'
```

Response:
```json
{
  "success": true,
  "pool": "primary",
  "previous_range": "0-89",
  "new_range": "0-99",
  "current_value": 70,
  "timestamp": "2026-05-13T01:23:19.304Z"
}
```

⚠️ **Safety**: Cannot shrink range if current value exceeds new max!

### Reset Counter (Auth Required)
```bash
curl -X POST https://number-distributor.wangjunli1983.workers.dev/api/reset \
  -H "Authorization: Bearer YOUR_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": 0}'
```

## Authentication

Use either header:
- `Authorization: Bearer sk-fCIHbAWDMPBb36cv6OShwOxlEMeZKh--0Bl4qqnxD_k`
- `X-API-Token: sk-fCIHbAWDMPBb36cv6OShwOxlEMeZKh--0Bl4qqnxD_k`

⚠️ **Security**: Replace default token in production!

## Deployment

```bash
# Install dependencies
npm install -g wrangler

# Login to Cloudflare
wrangler login

# Deploy
wrangler deploy

# View logs
wrangler tail
```

## Development

```bash
# Local development
wrangler dev

# Test locally
curl http://localhost:8787/api/current
```

## Tech Stack

- **Runtime**: Cloudflare Workers
- **Storage**: Durable Objects (persistent state)
- **Language**: JavaScript/TypeScript compatible

## Changelog

### v3.0 (2026-05-13) - Dynamic Pool Configuration 🎉
- ✅ Added dynamic pool configuration API (`/api/configure-pool`, `/api/pool-config`)
- ✅ Pools now support customizable min/max ranges
- ✅ Safe updates: Current counter values are preserved during configuration changes
- ✅ Safety validation: Rejects range changes that would invalidate existing values
- ✅ All endpoints now return dynamic `range` and `total_pool` values
- ✅ Backward compatible: Existing code continues to work without changes

### v2.0 (2026-03-27)
- ✅ Added second distribution pool (0-4)
- ✅ New endpoints: `/api/distribute2`, `/api/current2`, `/api/reset2`
- ✅ Maintained backward compatibility with original pool

### v1.0 (Initial)
- Basic number distribution (0-99)
- Durable Objects storage
- CORS support
