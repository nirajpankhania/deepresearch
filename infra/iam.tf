# Three service accounts, so that no identity holds a permission it does not
# need. In particular the API cannot read the Valyu key and cannot reach Vertex
# AI: it accepts requests and enqueues work, and that is all it can do.

resource "google_service_account" "api" {
  account_id   = "dr-api"
  display_name = "DeepResearch API (Cloud Run)"
  description  = "Accepts research questions, writes task documents, enqueues work."
}

resource "google_service_account" "worker" {
  account_id   = "dr-worker"
  display_name = "DeepResearch worker (Cloud Run)"
  description  = "Runs the research pipeline: Valyu retrieval, Vertex AI, trace upload."
}

# The identity Cloud Tasks presents when calling the worker. Deliberately
# separate from the API's identity: the API's job is to enqueue, and it should
# not itself be able to invoke the worker directly. The only path from a request
# to a running task goes through the queue, which is where the retry policy and
# the duplicate-enqueue rejection live.
resource "google_service_account" "tasks_invoker" {
  account_id   = "dr-tasks-invoker"
  display_name = "DeepResearch Cloud Tasks invoker"
  description  = "OIDC identity Cloud Tasks uses to call the worker's /process endpoint."
}

# --- API permissions -------------------------------------------------------

resource "google_project_iam_member" "api_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_tasks_queue_iam_member" "api_enqueuer" {
  project  = var.project_id
  location = google_cloud_tasks_queue.research.location
  name     = google_cloud_tasks_queue.research.name
  role     = "roles/cloudtasks.enqueuer"
  member   = "serviceAccount:${google_service_account.api.email}"
}

# Creating a task that carries an OIDC token requires actAs on the identity that
# token will be issued for. This grants the API permission to name the invoker
# in a task, not permission to mint tokens as it.
resource "google_service_account_iam_member" "api_acts_as_invoker" {
  service_account_id = google_service_account.tasks_invoker.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# --- Worker permissions ----------------------------------------------------

resource "google_project_iam_member" "worker_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

resource "google_project_iam_member" "worker_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# Scoped to the traces bucket, and to writing objects rather than administering
# the bucket.
resource "google_storage_bucket_iam_member" "worker_traces" {
  bucket = google_storage_bucket.traces.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.worker.email}"
}

# NOTE: roles/run.invoker for the tasks_invoker service account on the worker
# service is granted by scripts/deploy.sh, not here. The binding targets a
# Cloud Run service, and Cloud Run is deployed from source by that script
# precisely so Terraform never needs to know an image digest. Terraform cannot
# reference a service it does not manage without failing on first apply.
