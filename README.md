# DeepResearch

An asynchronous research backend for scientific questions. A question is
submitted over HTTP and returns immediately with a task id; the answer is
produced out of band by a pipeline that plans sub-queries, retrieves sources via
Valyu, deduplicates and reranks them, synthesises a cited report, and verifies
each claim against the sources it cites.

Backend runs on Google Cloud (Cloud Run, Cloud Tasks, Firestore, Cloud Storage,
Vertex AI). Frontend is a Next.js app on Vercel.

> **Status: Phase 0 (scaffold).** The workspace, container, and infrastructure
> definitions are in place and verified. The task lifecycle lands in Phase 1.
> See [`docs/design.md`](docs/design.md) for the full design and rationale.

---

## Layout

```
apps/api/        Cloud Run — HTTP handlers, task creation and retrieval
apps/worker/     Cloud Run — the research pipeline
apps/web/        Next.js — deployed to Vercel                      (Phase 4)
packages/shared/ Types and the queue interface, defined once
infra/           Terraform — queue, bucket, service accounts, IAM, secrets
scripts/         Deploy and smoke-test scripts
Dockerfile       One image, ROLE=api|worker
```

## Requirements

- Node 22+ and pnpm 9
- Docker (for building the container)
- Terraform 1.9+
- gcloud CLI, authenticated against the target project

## Local setup

```bash
pnpm install
cp .env.example .env      # then fill in the blanks
pnpm build
```

`.env.example` documents every variable and which service reads it. The two
secrets are `VALYU_API_KEY` and `BACKEND_API_KEY`; generate the latter with
`openssl rand -hex 32`.

Run the services locally, in two terminals:

```bash
pnpm dev:api      # :8080
pnpm dev:worker   # :8081
```

With `DISPATCHER=local`, the API posts straight to the worker and skips Cloud
Tasks. Firestore is the real thing in both local and deployed environments, so
the claim transaction and lease behaviour never diverge.

## Infrastructure

```bash
terraform -chdir=infra init
terraform -chdir=infra apply
```

Terraform manages the Cloud Tasks queue, the traces bucket, three service
accounts, their IAM bindings, and the `backend-api-key` secret *container*. It
never manages a secret value — those are added out of band:

```bash
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets versions add backend-api-key --data-file=-
```

Cloud Run is deployed by script rather than Terraform, so that Terraform never
needs to know an image digest.

## Container

```bash
docker build -t deepresearch .
docker run --rm -p 8080:8080 --env-file .env -e ROLE=api    deepresearch
docker run --rm -p 8081:8080 --env-file .env -e ROLE=worker deepresearch
```

---

## Still to document

Deployment instructions, example API usage, the architecture overview, the cost
note, the scaling writeup, example output, and known limitations. These land in
Phase 6.
