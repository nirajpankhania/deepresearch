terraform {
  required_version = ">= 1.9.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.12"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State is local and gitignored. For a single-operator project with no
  # concurrent applies, a remote backend would add a bootstrap step (a bucket
  # that must exist before Terraform runs) without buying anything. Recorded
  # under known limitations in the README, along with what a team setup needs:
  # a GCS backend with state locking.
}

provider "google" {
  project = var.project_id
  region  = var.region
}
