terraform {
  required_version = ">= 1.6"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Production: remote, encrypted, locked state (state never holds secret values in this design).
  # backend "s3" {
  #   bucket         = "<org>-tfstate"
  #   key            = "ticket-extractor/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "tfstate-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region = var.region

  # mock_mode lets `terraform plan` run fully offline with dummy credentials: no AWS calls, no cost.
  skip_credentials_validation = var.mock_mode
  skip_requesting_account_id  = var.mock_mode
  skip_metadata_api_check     = var.mock_mode
  access_key                  = var.mock_mode ? "mock" : null
  secret_key                  = var.mock_mode ? "mock" : null

  default_tags {
    tags = {
      Project   = var.name
      ManagedBy = "terraform"
    }
  }
}
