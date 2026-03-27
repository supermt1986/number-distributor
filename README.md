# Number Distributor - Cloudflare Worker

A distributed number allocation service using Cloudflare Durable Objects.

## Features

- **Pool 1 (0-99)**: Original distribution pool with 100 numbers
- **Pool 2 (0-4)**: New small pool with 5 numbers (newly added)

## API Endpoints

### Health & Info

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET | `/` | Service info | ❌ No |
| GET | `/health` | Health check | ❌ No |

### Pool 1 (0-99)

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

### v2.0 (2026-03-27)
- ✅ Added second distribution pool (0-4)
- ✅ New endpoints: `/api/distribute2`, `/api/current2`, `/api/reset2`
- ✅ Maintained backward compatibility with original pool

### v1.0 (Initial)
- Basic number distribution (0-99)
- Durable Objects storage
- CORS support
