resource "aws_ecr_repository" "api" {
  name                 = "${var.name}-api"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 20 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 20 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_db_subnet_group" "main" {
  name       = var.name
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = var.name
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  db_name  = "app"
  username = "app"
  # RDS generates the password and stores it in Secrets Manager: it never appears in code or Terraform state.
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  multi_az                  = var.db_multi_az
  db_subnet_group_name      = aws_db_subnet_group.main.name
  vpc_security_group_ids    = [aws_security_group.db.id]
  publicly_accessible       = false
  backup_retention_period   = 7
  deletion_protection       = true
  skip_final_snapshot       = false
  final_snapshot_identifier = "${var.name}-final"
}

# --- application secrets: only the *containers* are managed here ---
# Values are loaded out-of-band (see README "Secrets"), so they never touch code, CI logs or state.
resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${var.name}/jwt-secret"
  description             = "JWT signing key"
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "anthropic" {
  name                    = "${var.name}/anthropic-api-key"
  description             = "LLM provider API key"
  recovery_window_in_days = 7
}
