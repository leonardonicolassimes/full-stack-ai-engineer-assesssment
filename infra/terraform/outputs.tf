output "alb_dns_name" {
  value = aws_lb.main.dns_name
}

output "ecr_repository_url" {
  value = aws_ecr_repository.api.repository_url
}

output "jwt_secret_id" {
  value = aws_secretsmanager_secret.jwt.id
}

output "anthropic_secret_id" {
  value = aws_secretsmanager_secret.anthropic.id
}

output "migrate_command" {
  description = "One-off DB migration task (run after deploy, before shifting traffic)."
  value       = "aws ecs run-task --cluster ${aws_ecs_cluster.main.name} --launch-type FARGATE --task-definition ${aws_ecs_task_definition.api.family} --overrides '{\"containerOverrides\":[{\"name\":\"api\",\"command\":[\"node\",\"backend/dist/db/migrate.js\"]}]}' --network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.app.id}]}'"
}
