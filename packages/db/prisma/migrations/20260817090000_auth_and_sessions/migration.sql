-- Authentication, GitHub App access, and authenticated workspace model.
-- Prototype workspace/repository rows are intentionally removed because their
-- pre-auth shape cannot be mapped safely to a user-owned workspace.
DROP TABLE IF EXISTS "AgentTask" CASCADE;
DROP TABLE IF EXISTS "Sandbox" CASCADE;
DROP TABLE IF EXISTS "Repository" CASCADE;
DROP TABLE IF EXISTS "Workspace" CASCADE;

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "githubId" INTEGER NOT NULL,
  "githubLogin" TEXT NOT NULL,
  "githubName" TEXT,
  "githubEmail" TEXT,
  "avatarUrl" TEXT,
  "githubAccessToken" TEXT,
  "githubRefreshToken" TEXT,
  "githubTokenExpiresAt" TIMESTAMP(3),
  "githubRefreshExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_githubId_key" ON "User"("githubId");

CREATE TABLE "AuthSession" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

CREATE TABLE "GithubInstallation" (
  "id" TEXT NOT NULL,
  "installationId" INTEGER NOT NULL,
  "userId" TEXT NOT NULL,
  "accountId" INTEGER NOT NULL,
  "accountLogin" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "repositorySelection" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GithubInstallation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GithubInstallation_installationId_key" ON "GithubInstallation"("installationId");
CREATE INDEX "GithubInstallation_userId_idx" ON "GithubInstallation"("userId");
CREATE INDEX "GithubInstallation_accountId_idx" ON "GithubInstallation"("accountId");

CREATE TABLE "GithubInstallState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GithubInstallState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GithubInstallState_stateHash_key" ON "GithubInstallState"("stateHash");
CREATE INDEX "GithubInstallState_userId_idx" ON "GithubInstallState"("userId");
CREATE INDEX "GithubInstallState_expiresAt_idx" ON "GithubInstallState"("expiresAt");

CREATE TABLE "GithubOAuthState" (
  "id" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  CONSTRAINT "GithubOAuthState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GithubOAuthState_stateHash_key" ON "GithubOAuthState"("stateHash");
CREATE INDEX "GithubOAuthState_expiresAt_idx" ON "GithubOAuthState"("expiresAt");
CREATE INDEX "GithubOAuthState_userId_idx" ON "GithubOAuthState"("userId");

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "repositoryId" TEXT,
  "name" TEXT NOT NULL,
  "workspaceKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Workspace_workspaceKey_key" ON "Workspace"("workspaceKey");
CREATE INDEX "Workspace_userId_idx" ON "Workspace"("userId");
CREATE INDEX "Workspace_repositoryId_idx" ON "Workspace"("repositoryId");

CREATE TABLE "Repository" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "installationId" TEXT,
  "githubId" INTEGER NOT NULL,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "cloneUrl" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL DEFAULT 'main',
  "isPrivate" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Repository_userId_githubId_key" ON "Repository"("userId", "githubId");
CREATE INDEX "Repository_userId_idx" ON "Repository"("userId");
CREATE INDEX "Repository_installationId_idx" ON "Repository"("installationId");

CREATE TABLE "Sandbox" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "containerId" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "codeServerPort" INTEGER NOT NULL,
  "codeServerUrl" TEXT NOT NULL,
  "previewUrl" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'created',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sandbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sandbox_containerId_key" ON "Sandbox"("containerId");
CREATE INDEX "Sandbox_workspaceId_idx" ON "Sandbox"("workspaceId");

CREATE TABLE "AgentTask" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "result" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentTask_workspaceId_idx" ON "AgentTask"("workspaceId");

CREATE TABLE "ChatMessage" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatMessage_workspaceId_createdAt_idx" ON "ChatMessage"("workspaceId", "createdAt");

ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GithubInstallation" ADD CONSTRAINT "GithubInstallation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GithubInstallState" ADD CONSTRAINT "GithubInstallState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GithubOAuthState" ADD CONSTRAINT "GithubOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GithubInstallation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Sandbox" ADD CONSTRAINT "Sandbox_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AgentTask" ADD CONSTRAINT "AgentTask_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
