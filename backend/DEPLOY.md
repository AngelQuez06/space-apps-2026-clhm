# Deploy: Cloud Run + custom domain

The live API runs on Google Cloud Run at `https://api.clhm.study` (domain `clhm.study` from the GoDaddy sponsorship). The code includes a Dockerfile, gunicorn, a CORS allow-list, rate limits, and security headers. Replace `<your-gcp-project-id>` and the domain names with your own.

## 1. One-time setup
1. Install the gcloud CLI and log in: `gcloud auth login`.
2. `gcloud config set project <your-gcp-project-id>`
3. Make sure billing is linked to the project.
4. `gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com`
5. Recommended: create a budget alert in Billing so a traffic spike cannot burn the credits.

## 2. Deploy (from the repo root)
```bash
gcloud run deploy mars-backend \
  --source backend \
  --region us-central1 \
  --allow-unauthenticated \
  --max-instances 3 \
  --memory 1Gi \
  --set-env-vars "^;^CORS_ORIGINS=https://clhm.study,https://www.clhm.study"
```
- `--allow-unauthenticated` makes the API public (it only serves public NASA data).
- `--max-instances 3` caps cost and abuse. The rate limit is per instance, so it is a soft cap.
- 1 GiB: the 10 m HiRISE patches (`data/dtm`, about 160 MB of arrays once loaded) plus the tile cache in `/tmp` (which counts as memory) do not fit comfortably in 512 MiB.
- The tile cache lives in `/tmp` and is lost when an instance restarts; tiles are downloaded again from NASA.
- Cloud Run gives a `https://mars-backend-<hash>-uc.a.run.app` URL immediately. Test it: `curl https://<that-url>/api/health`.
- Redeploys after code changes only need `gcloud run deploy mars-backend --source backend --region us-central1 --memory 1Gi` (other settings are kept).

## 3. Custom domain
1. Verify ownership of the domain in Google Search Console (add the domain property and create the TXT record it shows in your DNS provider).
2. `gcloud beta run domain-mappings create --service mars-backend --domain api.clhm.study --region us-central1`
3. The command prints DNS records. Normally: CNAME `api` -> `ghs.googlehosted.com.` Create it in your DNS provider.
4. Wait for the managed HTTPS certificate (minutes to about an hour). Then check `https://api.clhm.study/api/health`.
- Domain mappings are a preview feature of Cloud Run. If it fails in the region, the alternative is a Google external HTTPS load balancer (more setup, extra cost).
- Never commit passwords, keys, or `.env` files.

## 4. Connect the frontend
- The frontend on Vercel forwards `/api/*` to the backend (`frontend/vercel.json`), so the website needs no CORS exception.
- To allow another origin (for example a Vercel preview URL), update CORS without rebuilding:
  `gcloud run services update mars-backend --region us-central1 --update-env-vars "^;^CORS_ORIGINS=https://clhm.study,https://www.clhm.study,https://<project>.vercel.app"`

## Settings (env vars)
| Var | Default | Notes |
| --- | --- | --- |
| `CORS_ORIGINS` | `https://clhm.study,https://www.clhm.study` | Comma-separated. `*` only for local dev (`backend/.env`). |
| `RATE_LIMIT_DEFAULT` | `120 per minute` | Per client IP and instance. |
| `RATE_LIMIT_TILES` | `1200 per minute` | Tile endpoints. |
| `RATE_LIMIT_ROUTE` | `10 per minute` | Route search (CPU-bound). |
| `TRUSTED_PROXY_HOPS` | `0` (Docker image: `1`) | Needed to read the real client IP behind Cloud Run. |
| `ENABLE_HSTS` | `0` (Docker image: `1`) | Only enable behind HTTPS. |
