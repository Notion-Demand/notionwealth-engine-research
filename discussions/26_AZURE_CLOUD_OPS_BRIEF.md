# Azure Cloud Ops Brief — Quantalyze Teardown

*As of 2026-10-18*

## What you had running in Azure

| Resource | Type | Purpose |
| --- | --- | --- |
| `quantalyze-prod-rg` | Resource Group | Logical container holding every resource below; billed and deleted together |
| Central India | Region | The physical Azure datacenter location everything ran in |
| `quantalyze-prod-vnet` | Virtual Network | Private network, split into subnets delegated to Postgres, Container Apps, and a one-off ACI jump box |
| `quantalyze-postgres` | Postgres Flexible Server | Managed Postgres, VNet-delegated — no public IP, reachable only from inside the VNet |
| `quantalyzestorage` | Blob Storage account | Object storage for 726 earnings-call transcript PDFs |
| `quantalyze-app-ca` | Container App | Hosted the live Next.js application |
| `quantalyzeacr` | Container Registry (ACR) | Private Docker image registry; also used to route around a Docker Hub rate-limit issue |
| `quantalyze-backup-jumpbox` | Container Instance (ACI) | Throwaway container spun up once, inside the VNet, to run `pg_dump` against the private Postgres server |
| App Insights | Monitoring | Application telemetry, logs, performance traces |
| DNS Zone | DNS | Custom domain routing for the app |
| Entra tenant (Demandion Innovations) | Identity | Company email/M365 *and* the app's sign-in — deliberately kept, not deleted |
| NAT Gateway | Networking | Gave the private subnets outbound internet without a public IP; torn down/recreated earlier as a cost-saving pause |

## Core concepts, explained

| Concept | Plain-language explanation |
| --- | --- |
| Region | The physical Azure datacenter a resource lives in (e.g. Central India) — picked for latency and sometimes data-residency rules. |
| Resource Group | A logical folder grouping related resources so they can be managed, billed, and deleted as one unit. |
| VNet (Virtual Network) | Your own private, isolated network inside Azure, split into subnets — address ranges you carve out for different purposes. |
| Subnet delegation | Handing a subnet over to a specific Azure service so its instances get private IPs inside your network instead of public ones. Postgres and Container Apps were both delegated — meaning no public IP, reachable only from inside the VNet. |
| NAT Gateway | Gives a private subnet shared *outbound* internet access (e.g. to pull packages) without exposing it to *inbound* traffic. |
| Docker / containers | Packaging an app plus its dependencies into a single portable image that runs the same way anywhere. |
| Azure Container Registry (ACR) | A private Docker image registry — where your built app image lives and where CI/CD pushes new builds. |
| Container Apps vs. Kubernetes | Container Apps is a serverless platform: give it an image, it runs and scales it (including to zero), handles HTTPS/ingress. Under the hood it's built on Kubernetes (KEDA for autoscaling, Dapr for service calls), but you never touch a cluster, `kubectl`, or YAML manifests yourself. Precise way to say it: *Kubernetes-powered infrastructure, not self-managed Kubernetes.* |
| Azure Container Instances (ACI) | Bare-bones "run one container, once, no orchestration" service — used here as a disposable jump box inside the VNet to reach the otherwise-private Postgres server. |
| Managed Postgres (Flexible Server) | Postgres-as-a-service — Azure handles patching, backups, HA; you just connect. VNet-integrated networking is set at creation and effectively permanent. |
| Blob Storage | Object storage: a cloud "folder" for arbitrary files, no query engine — just key → file. |
| Application Insights | Azure's APM/observability service: telemetry, logs, performance traces from a running app. |
| DNS Zone | Hosts the DNS records that point a custom domain at your app. |
| Microsoft Entra ID / Entra External ID | Microsoft's identity platform. Entra ID runs employee identity (your company email/M365); Entra External ID (CIAM) is the customer-identity flavor, used here for end-user "Sign in with Microsoft" via an app registration (client ID + secret). |
| GitHub Actions CI/CD via OIDC | The deploy pipeline. OIDC means GitHub authenticates to Azure with short-lived federated tokens instead of a long-lived stored password — more secure, nothing to leak or rotate. |

## Commands and operations run, by category

| Category | Representative commands | What it did |
| --- | --- | --- |
| Compute lifecycle | `az postgres flexible-server start/stop/update`, `az container create/show/logs/delete` | Started/stopped the database; created, monitored, and tore down the ACI jump box |
| Networking | `az network vnet subnet create/list/show` | Found and reused an existing VNet subnet already delegated to Container Instances |
| Storage | `az storage account update`, `az storage container create`, `az storage blob upload/download/download-batch` | Toggled public network access; created a container for the DB dump; moved files in and out of Blob Storage |
| Registry workaround | `az acr update --admin-enabled`, `az acr import` | Imported a Docker Hub image into our own private ACR server-side, bypassing Docker Hub's anonymous pull rate-limit on shared cloud IPs |
| App inspection | `az containerapp list/show`, `az containerapp secret list --show-values` | Listed the running app, its env vars, and its actual secret values before teardown |
| Teardown | `az group delete --name <rg> --yes --no-wait` | Deleted every resource in the resource group in one background operation |

## War stories worth mentioning

These show real troubleshooting, not just command-running.

- **VNet delegation is a one-way door.** A Postgres server's networking mode is fixed at creation when it's VNet-delegated — the CLI accepts a command to make it public with no error, but the setting silently never takes effect. Confirmed by reading the actual downstream error (a firewall-rule operation refusing to run), not by assuming.
- **Client/server version mismatch on `pg_dump`.** An older `pg_dump` refuses to dump from a newer Postgres server (16 vs. 17) — a classic backup gotcha; the fix is matching the dump tool's version to the server's.
- **Docker Hub anonymous-pull rate limiting from cloud container platforms.** A well-known pain point on shared cloud IP ranges. Worked around by having Azure import the image into a private registry first (`az acr import`), which pulls server-side through Microsoft's infrastructure instead of hitting Docker Hub's public rate limit directly.
- **macOS case-insensitive filesystem vs. case-distinct cloud blob names.** Two files differing only by case (e.g. `BAJAJ_Q1.pdf` vs. `Bajaj_Q1.pdf`) collide on a normal Mac volume. Solved with a case-sensitive APFS disk image — which also conveniently solved a second problem: moving one big file to an external drive instead of hundreds of thousands of small ones.
