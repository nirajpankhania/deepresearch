# Terraform manages secret *containers* and who may read them. It never manages
# a secret value: putting one in a resource argument puts it in state, and state
# is a file on a laptop. Both values are added out of band with
#   gcloud secrets versions add <name> --data-file=-
# and the README documents that step.

# Created manually before this configuration existed, so it is read rather than
# managed. Terraform still owns the access binding below, which is the part that
# matters for review.
data "google_secret_manager_secret" "valyu_api_key" {
  secret_id = "valyu-api-key"
}

# The self-issued token the Next.js route handler presents to the API. Container
# only; the value is generated with `openssl rand -hex 32` and added by hand.
resource "google_secret_manager_secret" "backend_api_key" {
  secret_id = "backend-api-key"

  replication {
    auto {}
  }
}

# Only the worker can read the Valyu key. The API never touches it, which is why
# a compromised API service cannot spend Valyu credit.
resource "google_secret_manager_secret_iam_member" "worker_reads_valyu_key" {
  secret_id = data.google_secret_manager_secret.valyu_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_secret_manager_secret_iam_member" "api_reads_backend_key" {
  secret_id = google_secret_manager_secret.backend_api_key.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}
