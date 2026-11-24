CREATE TABLE `teams` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `leader_id` CHAR(36) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `created_at` TIMESTAMP(0) NULL,
    `updated_at` TIMESTAMP(0) NULL,
    INDEX `teams_leader_id_foreign`(`leader_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `users` ADD COLUMN `team_id` CHAR(36) NULL;
ALTER TABLE `taken_tasks` ADD COLUMN `team_id` CHAR(36) NULL;

CREATE INDEX `users_team_id_foreign` ON `users`(`team_id`);
CREATE INDEX `taken_tasks_team_id_foreign` ON `taken_tasks`(`team_id`);

ALTER TABLE `users`
    ADD CONSTRAINT `users_team_id_fkey`
    FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `taken_tasks`
    ADD CONSTRAINT `taken_tasks_team_id_fkey`
    FOREIGN KEY (`team_id`) REFERENCES `teams`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT;

ALTER TABLE `teams`
    ADD CONSTRAINT `teams_leader_id_fkey`
    FOREIGN KEY (`leader_id`) REFERENCES `users`(`id`)
    ON DELETE SET NULL ON UPDATE RESTRICT;
