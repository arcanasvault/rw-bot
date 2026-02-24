# @remnawave/backend-contract Documentation

## Overview

`@remnawave/backend-contract` is the TypeScript contract package for the Remnawave backend API.

It gives you:

- Typed command namespaces (one namespace per endpoint)
- Request/response schemas and inferred types
- URL builders (`url`, `TSQ_url`)
- Endpoint metadata (`endpointDetails.REQUEST_METHOD`, etc.)

Main purpose:

- Type-safe interaction with Remnawave REST API from your own client code (backend services, bots, frontends).

Important compatibility note:

- Match contract version to panel/backend version.
- Example: contract `2.6.1` with Remnawave backend `2.6.1`.

Important limitation:

- This package is **not an HTTP client**.
- You must call the API yourself via `axios`, `fetch`, `got`, `ky`, Nest `HttpService`, etc.

## Installation

```bash
npm i @remnawave/backend-contract
```

```bash
yarn add @remnawave/backend-contract
```

```bash
pnpm add @remnawave/backend-contract
```

Runtime dependencies:

- `zod` is included as a package dependency.
- No peer dependencies are required for the contract itself.
- Add your preferred HTTP client separately (for example `axios`).

## Authentication

Use a Bearer token in `Authorization` header.

Common approaches:

1. Login as superadmin:
   - `LoginCommand` (`POST /api/auth/login`) returns `response.accessToken`.
2. Use panel API token:
   - Usually preferred for automation/bots (create/manage via panel or token endpoints).

Header:

```http
Authorization: Bearer <token>
```

## Core Concepts

Command pattern (namespace-based):

- Each endpoint is represented by a namespace like `CreateUserCommand`.
- Typical members:
  - `url` (string or function)
  - `TSQ_url` (path template helper for TSQ use)
  - `endpointDetails` (method + controller route metadata)
  - `RequestSchema`, `Request` type
  - `ResponseSchema`, `Response` type
  - Optional `RequestQuerySchema` / `RequestBodySchema`

Typical structure:

```ts
import { CreateUserCommand } from '@remnawave/backend-contract';

// URL:
CreateUserCommand.url; // '/api/users'

// Method:
CreateUserCommand.endpointDetails.REQUEST_METHOD; // 'post'

// Types:
type CreateUserReq = CreateUserCommand.Request;
type CreateUserRes = CreateUserCommand.Response;
```

Response envelope pattern:

- Most JSON responses are wrapped as:

```ts
{ response: ... }
```

Validation:

- You can validate server payloads with `Command.ResponseSchema.parse(data)` for runtime safety.

## Usage Example (Generic)

```ts
import axios, { AxiosError, Method } from 'axios';
import { z } from 'zod';
import {
  CreateUserCommand,
  GetUserByUsernameCommand,
  UpdateUserCommand,
} from '@remnawave/backend-contract';

const api = axios.create({
  baseURL: 'https://panel.example.com', // commands already include '/api/...'
  timeout: 15000,
  headers: {
    Authorization: `Bearer ${process.env.REMNAWAVE_TOKEN}`,
    'Content-Type': 'application/json',
  },
});

async function execCommand<TResponse>(args: {
  method: Method;
  url: string;
  params?: Record<string, unknown>;
  data?: unknown;
  schema?: z.ZodType<TResponse>;
}): Promise<TResponse> {
  try {
    const res = await api.request<TResponse>({
      method: args.method,
      url: args.url,
      params: args.params,
      data: args.data,
    });

    return args.schema ? args.schema.parse(res.data) : res.data;
  } catch (error) {
    const err = error as AxiosError<any>;
    const status = err.response?.status;
    const payload = err.response?.data;
    throw new Error(
      `Remnawave API error: status=${status ?? 'unknown'} body=${JSON.stringify(payload)}`,
    );
  }
}

// Example: upsert by username
async function upsertUser() {
  const username = 'tg_123456789';
  const trafficLimitBytes = 20 * 1024 * 1024 * 1024;
  const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const found = await execCommand<GetUserByUsernameCommand.Response>({
      method: GetUserByUsernameCommand.endpointDetails.REQUEST_METHOD,
      url: GetUserByUsernameCommand.url(username),
      schema: GetUserByUsernameCommand.ResponseSchema,
    });

    return execCommand<UpdateUserCommand.Response>({
      method: UpdateUserCommand.endpointDetails.REQUEST_METHOD,
      url: UpdateUserCommand.url,
      data: {
        uuid: found.response.uuid,
        trafficLimitBytes,
        expireAt,
      } satisfies UpdateUserCommand.Request,
      schema: UpdateUserCommand.ResponseSchema,
    });
  } catch {
    return execCommand<CreateUserCommand.Response>({
      method: CreateUserCommand.endpointDetails.REQUEST_METHOD,
      url: CreateUserCommand.url,
      data: {
        username,
        trafficLimitBytes,
        expireAt,
      } satisfies CreateUserCommand.Request,
      schema: CreateUserCommand.ResponseSchema,
    });
  }
}
```

## Endpoints / Commands — Full List

Notes:

- List below is aligned with `2.6.1` contract exports.
- Paths use `:param` notation.
- For detailed request/response shapes, rely on each command’s `RequestSchema`/`ResponseSchema`.
- For tables below, snippets assume you use the generic `execCommand(...)` style from the previous section.

### Auth & API Tokens

| Command                                  | Method   | Path                                       | Purpose                         | Request / Response (main)                                   | Example                                           |
| ---------------------------------------- | -------- | ------------------------------------------ | ------------------------------- | ----------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------- |
| `LoginCommand`                           | `POST`   | `/api/auth/login`                          | Superadmin login                | `{ username, password }` -> `{ response: { accessToken } }` | `await api.post(LoginCommand.url, body)`          |
| `RegisterCommand`                        | `POST`   | `/api/auth/register`                       | Initial superadmin registration | `{ username, password }` -> `{ response: { accessToken } }` | `await api.post(RegisterCommand.url, body)`       |
| `GetStatusCommand`                       | `GET`    | `/api/auth/status`                         | Auth capabilities/status        | none -> auth/branding flags                                 | `await api.get(GetStatusCommand.url)`             |
| `OAuth2AuthorizeCommand`                 | `POST`   | `/api/auth/oauth2/authorize`               | Start OAuth2 auth flow          | provider payload                                            | URL/token data                                    | `await api.post(OAuth2AuthorizeCommand.url, body)`             |
| `OAuth2CallbackCommand`                  | `POST`   | `/api/auth/oauth2/callback`                | OAuth2 callback completion      | callback payload                                            | `{ accessToken }`                                 | `await api.post(OAuth2CallbackCommand.url, body)`              |
| `TelegramCallbackCommand`                | `POST`   | `/api/auth/oauth2/tg/callback`             | Telegram OAuth callback         | Telegram auth payload                                       | `{ accessToken }`                                 | `await api.post(TelegramCallbackCommand.url, body)`            |
| `GetPasskeyAuthenticationOptionsCommand` | `GET`    | `/api/auth/passkey/authentication/options` | Passkey login challenge         | query payload                                               | challenge/options                                 | `await api.get(GetPasskeyAuthenticationOptionsCommand.url)`    |
| `VerifyPasskeyAuthenticationCommand`     | `POST`   | `/api/auth/passkey/authentication/verify`  | Verify passkey login            | assertion payload                                           | `{ accessToken }`                                 | `await api.post(VerifyPasskeyAuthenticationCommand.url, body)` |
| `CreateApiTokenCommand`                  | `POST`   | `/api/tokens`                              | Create API token                | `{ tokenName }` -> `{ token, uuid }`                        | `await api.post(CreateApiTokenCommand.url, body)` |
| `FindAllApiTokensCommand`                | `GET`    | `/api/tokens`                              | List API tokens                 | none -> `{ apiKeys, docs }`                                 | `await api.get(FindAllApiTokensCommand.url)`      |
| `DeleteApiTokenCommand`                  | `DELETE` | `/api/tokens/:uuid`                        | Remove API token                | `uuid` param                                                | `{ response: boolean }`                           | `await api.delete(DeleteApiTokenCommand.url(uuid))`            |

### Users (Critical for VPN purchase bots)

| Command                                    | Method   | Path                                            | Purpose                                    | Request / Response (main)                                       | Example                                                             |
| ------------------------------------------ | -------- | ----------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `CreateUserCommand`                        | `POST`   | `/api/users`                                    | Create user with limits/expiry             | `username, trafficLimitBytes, expireAt, ...` -> `ExtendedUsers` | `await api.post(CreateUserCommand.url, body)`                       |
| `UpdateUserCommand`                        | `PATCH`  | `/api/users`                                    | Update user (uuid or username)             | `uuid/username + patch fields` -> `ExtendedUsers`               | `await api.patch(UpdateUserCommand.url, body)`                      |
| `GetAllUsersCommand`                       | `GET`    | `/api/users`                                    | Paginated/filter list                      | query: `start,size,filters,sorting` -> `{ users,total }`        | `await api.get(GetAllUsersCommand.url, { params })`                 |
| `GetUserByUuidCommand`                     | `GET`    | `/api/users/:uuid`                              | Fetch single user                          | `uuid` -> `ExtendedUsers`                                       | `await api.get(GetUserByUuidCommand.url(uuid))`                     |
| `DeleteUserCommand`                        | `DELETE` | `/api/users/:uuid`                              | Delete user                                | `uuid` -> `{ isDeleted }`                                       | `await api.delete(DeleteUserCommand.url(uuid))`                     |
| `GetUserByUsernameCommand`                 | `GET`    | `/api/users/by-username/:username`              | Lookup by username                         | `username` -> `ExtendedUsers`                                   | `await api.get(GetUserByUsernameCommand.url(username))`             |
| `GetUserByShortUuidCommand`                | `GET`    | `/api/users/by-short-uuid/:shortUuid`           | Lookup by short UUID                       | `shortUuid` -> `ExtendedUsers`                                  | `await api.get(GetUserByShortUuidCommand.url(shortUuid))`           |
| `GetUserByIdCommand`                       | `GET`    | `/api/users/by-id/:id`                          | Lookup by numeric id                       | `id` -> `ExtendedUsers`                                         | `await api.get(GetUserByIdCommand.url(id))`                         |
| `GetUserByTelegramIdCommand`               | `GET`    | `/api/users/by-telegram-id/:telegramId`         | Find user(s) by TG id                      | `telegramId` -> `ExtendedUsers[]`                               | `await api.get(GetUserByTelegramIdCommand.url(tgId))`               |
| `GetUserByEmailCommand`                    | `GET`    | `/api/users/by-email/:email`                    | Find user(s) by email                      | `email` -> `ExtendedUsers[]`                                    | `await api.get(GetUserByEmailCommand.url(email))`                   |
| `GetUserByTagCommand`                      | `GET`    | `/api/users/by-tag/:tag`                        | Find users by tag                          | `tag` -> `ExtendedUsers[]`                                      | `await api.get(GetUserByTagCommand.url(tag))`                       |
| `GetUserAccessibleNodesCommand`            | `GET`    | `/api/users/:uuid/accessible-nodes`             | Nodes available for user                   | `uuid` -> nodes[]                                               | `await api.get(GetUserAccessibleNodesCommand.url(uuid))`            |
| `GetUserSubscriptionRequestHistoryCommand` | `GET`    | `/api/users/:uuid/subscription-request-history` | User subscription request logs             | `uuid` -> history[]                                             | `await api.get(GetUserSubscriptionRequestHistoryCommand.url(uuid))` |
| `EnableUserCommand`                        | `POST`   | `/api/users/:uuid/actions/enable`               | Enable user                                | `uuid` -> `ExtendedUsers`                                       | `await api.post(EnableUserCommand.url(uuid))`                       |
| `DisableUserCommand`                       | `POST`   | `/api/users/:uuid/actions/disable`              | Disable user                               | `uuid` -> `ExtendedUsers`                                       | `await api.post(DisableUserCommand.url(uuid))`                      |
| `ResetUserTrafficCommand`                  | `POST`   | `/api/users/:uuid/actions/reset-traffic`        | Reset used traffic counters                | `uuid` -> `ExtendedUsers`                                       | `await api.post(ResetUserTrafficCommand.url(uuid))`                 |
| `RevokeUserSubscriptionCommand`            | `POST`   | `/api/users/:uuid/actions/revoke`               | Revoke subscription credentials/short UUID | `uuid` + optional body                                          | `await api.post(RevokeUserSubscriptionCommand.url(uuid), body)`     |
| `GetAllTagsCommand`                        | `GET`    | `/api/users/tags`                               | User tags list                             | none -> tags[]                                                  | `await api.get(GetAllTagsCommand.url)`                              |
| `BulkDeleteUsersByStatusCommand`           | `POST`   | `/api/users/bulk/delete-by-status`              | Bulk delete by status                      | bulk payload                                                    | operation result                                                    | `await api.post(BulkDeleteUsersByStatusCommand.url, body)`     |
| `BulkUpdateUsersCommand`                   | `POST`   | `/api/users/bulk/update`                        | Bulk patch selected users                  | uuids + patch                                                   | result                                                              | `await api.post(BulkUpdateUsersCommand.url, body)`             |
| `BulkResetTrafficUsersCommand`             | `POST`   | `/api/users/bulk/reset-traffic`                 | Bulk reset traffic                         | uuids                                                           | result                                                              | `await api.post(BulkResetTrafficUsersCommand.url, body)`       |
| `BulkRevokeUsersSubscriptionCommand`       | `POST`   | `/api/users/bulk/revoke-subscription`           | Bulk revoke subscriptions                  | uuids/options                                                   | result                                                              | `await api.post(BulkRevokeUsersSubscriptionCommand.url, body)` |
| `BulkDeleteUsersCommand`                   | `POST`   | `/api/users/bulk/delete`                        | Bulk delete users                          | uuids                                                           | result                                                              | `await api.post(BulkDeleteUsersCommand.url, body)`             |
| `BulkUpdateUsersSquadsCommand`             | `POST`   | `/api/users/bulk/update-squads`                 | Bulk update squads                         | uuids + squads                                                  | result                                                              | `await api.post(BulkUpdateUsersSquadsCommand.url, body)`       |
| `BulkExtendExpirationDateCommand`          | `POST`   | `/api/users/bulk/extend-expiration-date`        | Bulk extend expiry                         | uuids + extension                                               | result                                                              | `await api.post(BulkExtendExpirationDateCommand.url, body)`    |
| `BulkAllUpdateUsersCommand`                | `POST`   | `/api/users/bulk/all/update`                    | Bulk update all users                      | patch filter                                                    | result                                                              | `await api.post(BulkAllUpdateUsersCommand.url, body)`          |
| `BulkAllResetTrafficUsersCommand`          | `POST`   | `/api/users/bulk/all/reset-traffic`             | Reset traffic for all                      | filter payload                                                  | result                                                              | `await api.post(BulkAllResetTrafficUsersCommand.url, body)`    |
| `BulkAllExtendExpirationDateCommand`       | `POST`   | `/api/users/bulk/all/extend-expiration-date`    | Extend expiry for all                      | filter payload                                                  | result                                                              | `await api.post(BulkAllExtendExpirationDateCommand.url, body)` |

### Subscription Access (Critical for delivering links/configs)

| Command                                         | Method | Path                                              | Purpose                                       | Request / Response (main)                                                   | Example                                                                          |
| ----------------------------------------------- | ------ | ------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `GetSubscriptionInfoByShortUuidCommand`         | `GET`  | `/api/sub/:shortUuid/info`                        | Public structured subscription info           | `shortUuid` -> `SubscriptionInfoSchema` (`links`, `subscriptionUrl`, usage) | `await api.get(GetSubscriptionInfoByShortUuidCommand.url(shortUuid))`            |
| `GetSubscriptionByShortUuidCommand`             | `GET`  | `/api/sub/:shortUuid`                             | Public raw subscription output                | `shortUuid` -> raw text/content                                             | `await api.get(GetSubscriptionByShortUuidCommand.url(shortUuid))`                |
| `GetSubscriptionByShortUuidByClientTypeCommand` | `GET`  | `/api/sub/:shortUuid/:clientType`                 | Client-specific public output                 | `shortUuid, clientType`                                                     | `await api.get(`/api/sub/${id}/${client}`)`                                      |
| `GetOutlineSubscriptionByShortUuidCommand`      | `GET`  | `/api/sub/outline/:shortUuid/:type/:encodedTag`   | Outline/typed config path                     | `shortUuid, type, encodedTag`                                               | `await api.get(`/api/sub/outline/${id}/${type}/${tag}`)`                         |
| `GetAllSubscriptionsCommand`                    | `GET`  | `/api/subscriptions`                              | Protected list of subscriptions               | query: `start,size` -> `{ subscriptions,total }`                            | `await api.get(GetAllSubscriptionsCommand.url, { params })`                      |
| `GetSubscriptionByUsernameCommand`              | `GET`  | `/api/subscriptions/by-username/:username`        | Protected subscription by username            | `username` -> subscription info                                             | `await api.get(GetSubscriptionByUsernameCommand.url(username))`                  |
| `GetSubscriptionByUuidCommand`                  | `GET`  | `/api/subscriptions/by-uuid/:uuid`                | Protected subscription by user UUID           | `uuid` -> subscription info                                                 | `await api.get(GetSubscriptionByUuidCommand.url(uuid))`                          |
| `GetSubscriptionByShortUuidProtectedCommand`    | `GET`  | `/api/subscriptions/by-short-uuid/:shortUuid`     | Protected subscription by short UUID          | `shortUuid` -> subscription info                                            | `await api.get(GetSubscriptionByShortUuidProtectedCommand.url(shortUuid))`       |
| `GetRawSubscriptionByShortUuidCommand`          | `GET`  | `/api/subscriptions/by-short-uuid/:shortUuid/raw` | Protected raw subscription + headers/hosts    | `shortUuid` + `withDisabledHosts?`                                          | `await api.get(GetRawSubscriptionByShortUuidCommand.url(shortUuid), { params })` |
| `GetSubpageConfigByShortUuidCommand`            | `GET`  | `/api/subscriptions/subpage-config/:shortUuid`    | Resolve subscription page config availability | `shortUuid` + request headers map                                           | `await api.get(GetSubpageConfigByShortUuidCommand.url(shortUuid))`               |

Important 2.6.x note:

- `CreateSubscriptionCommand` / `UpdateSubscriptionCommand` are **not exported** in this contract version.
- For plan purchase/renewal, use `CreateUserCommand` / `UpdateUserCommand` (traffic + expiry) and optionally subscription template/settings endpoints.

### Nodes

| Command                               | Method   | Path                                           |
| ------------------------------------- | -------- | ---------------------------------------------- |
| `CreateNodeCommand`                   | `POST`   | `/api/nodes`                                   |
| `GetAllNodesCommand`                  | `GET`    | `/api/nodes`                                   |
| `GetOneNodeCommand`                   | `GET`    | `/api/nodes/:uuid`                             |
| `UpdateNodeCommand`                   | `PATCH`  | `/api/nodes`                                   |
| `DeleteNodeCommand`                   | `DELETE` | `/api/nodes/:uuid`                             |
| `EnableNodeCommand`                   | `POST`   | `/api/nodes/:uuid/actions/enable`              |
| `DisableNodeCommand`                  | `POST`   | `/api/nodes/:uuid/actions/disable`             |
| `RestartNodeCommand`                  | `POST`   | `/api/nodes/:uuid/actions/restart`             |
| `ResetNodeTrafficCommand`             | `POST`   | `/api/nodes/:uuid/actions/reset-traffic`       |
| `RestartAllNodesCommand`              | `POST`   | `/api/nodes/actions/restart-all`               |
| `ReorderNodeCommand`                  | `POST`   | `/api/nodes/actions/reorder`                   |
| `BulkNodesProfileModificationCommand` | `POST`   | `/api/nodes/bulk-actions/profile-modification` |
| `BulkNodesActionsCommand`             | `POST`   | `/api/nodes/bulk-actions`                      |
| `GetAllNodesTagsCommand`              | `GET`    | `/api/nodes/tags`                              |

### Hosts

| Command                        | Method   | Path                          |
| ------------------------------ | -------- | ----------------------------- |
| `CreateHostCommand`            | `POST`   | `/api/hosts`                  |
| `GetAllHostsCommand`           | `GET`    | `/api/hosts`                  |
| `GetOneHostCommand`            | `GET`    | `/api/hosts/:uuid`            |
| `UpdateHostCommand`            | `PATCH`  | `/api/hosts`                  |
| `DeleteHostCommand`            | `DELETE` | `/api/hosts/:uuid`            |
| `ReorderHostCommand`           | `POST`   | `/api/hosts/actions/reorder`  |
| `BulkEnableHostsCommand`       | `POST`   | `/api/hosts/bulk/enable`      |
| `BulkDisableHostsCommand`      | `POST`   | `/api/hosts/bulk/disable`     |
| `BulkDeleteHostsCommand`       | `POST`   | `/api/hosts/bulk/delete`      |
| `SetInboundToManyHostsCommand` | `POST`   | `/api/hosts/bulk/set-inbound` |
| `SetPortToManyHostsCommand`    | `POST`   | `/api/hosts/bulk/set-port`    |
| `GetAllHostTagsCommand`        | `GET`    | `/api/hosts/tags`             |

### Config Profiles

| Command                                 | Method   | Path                                         |
| --------------------------------------- | -------- | -------------------------------------------- |
| `GetConfigProfilesCommand`              | `GET`    | `/api/config-profiles`                       |
| `CreateConfigProfileCommand`            | `POST`   | `/api/config-profiles`                       |
| `UpdateConfigProfileCommand`            | `PATCH`  | `/api/config-profiles`                       |
| `GetConfigProfileByUuidCommand`         | `GET`    | `/api/config-profiles/:uuid`                 |
| `DeleteConfigProfileCommand`            | `DELETE` | `/api/config-profiles/:uuid`                 |
| `GetInboundsByProfileUuidCommand`       | `GET`    | `/api/config-profiles/:uuid/inbounds`        |
| `GetComputedConfigProfileByUuidCommand` | `GET`    | `/api/config-profiles/:uuid/computed-config` |
| `GetAllInboundsCommand`                 | `GET`    | `/api/config-profiles/inbounds`              |
| `ReorderConfigProfileCommand`           | `POST`   | `/api/config-profiles/actions/reorder`       |

### Internal / External Squads

| Command                                  | Method   | Path                                                   |
| ---------------------------------------- | -------- | ------------------------------------------------------ |
| `GetInternalSquadsCommand`               | `GET`    | `/api/internal-squads`                                 |
| `CreateInternalSquadCommand`             | `POST`   | `/api/internal-squads`                                 |
| `UpdateInternalSquadCommand`             | `PATCH`  | `/api/internal-squads`                                 |
| `GetInternalSquadByUuidCommand`          | `GET`    | `/api/internal-squads/:uuid`                           |
| `DeleteInternalSquadCommand`             | `DELETE` | `/api/internal-squads/:uuid`                           |
| `GetInternalSquadAccessibleNodesCommand` | `GET`    | `/api/internal-squads/:uuid/accessible-nodes`          |
| `AddUsersToInternalSquadCommand`         | `POST`   | `/api/internal-squads/:uuid/bulk-actions/add-users`    |
| `DeleteUsersFromInternalSquadCommand`    | `DELETE` | `/api/internal-squads/:uuid/bulk-actions/remove-users` |
| `ReorderInternalSquadCommand`            | `POST`   | `/api/internal-squads/actions/reorder`                 |
| `GetExternalSquadsCommand`               | `GET`    | `/api/external-squads`                                 |
| `CreateExternalSquadCommand`             | `POST`   | `/api/external-squads`                                 |
| `UpdateExternalSquadCommand`             | `PATCH`  | `/api/external-squads`                                 |
| `GetExternalSquadByUuidCommand`          | `GET`    | `/api/external-squads/:uuid`                           |
| `DeleteExternalSquadCommand`             | `DELETE` | `/api/external-squads/:uuid`                           |
| `AddUsersToExternalSquadCommand`         | `POST`   | `/api/external-squads/:uuid/bulk-actions/add-users`    |
| `DeleteUsersFromExternalSquadCommand`    | `DELETE` | `/api/external-squads/:uuid/bulk-actions/remove-users` |
| `ReorderExternalSquadCommand`            | `POST`   | `/api/external-squads/actions/reorder`                 |

### Subscription Templates / Settings / Page Config / History

| Command                                     | Method   | Path                                             |
| ------------------------------------------- | -------- | ------------------------------------------------ |
| `GetSubscriptionTemplatesCommand`           | `GET`    | `/api/subscription-templates`                    |
| `CreateSubscriptionTemplateCommand`         | `POST`   | `/api/subscription-templates`                    |
| `UpdateSubscriptionTemplateCommand`         | `PATCH`  | `/api/subscription-templates`                    |
| `GetSubscriptionTemplateCommand`            | `GET`    | `/api/subscription-templates/:uuid`              |
| `DeleteSubscriptionTemplateCommand`         | `DELETE` | `/api/subscription-templates/:uuid`              |
| `ReorderSubscriptionTemplateCommand`        | `POST`   | `/api/subscription-templates/actions/reorder`    |
| `GetSubscriptionSettingsCommand`            | `GET`    | `/api/subscription-settings`                     |
| `UpdateSubscriptionSettingsCommand`         | `PATCH`  | `/api/subscription-settings`                     |
| `GetSubscriptionPageConfigsCommand`         | `GET`    | `/api/subscription-page-configs`                 |
| `GetSubscriptionPageConfigCommand`          | `GET`    | `/api/subscription-page-configs/:uuid`           |
| `CreateSubscriptionPageConfigCommand`       | `POST`   | `/api/subscription-page-configs`                 |
| `UpdateSubscriptionPageConfigCommand`       | `PATCH`  | `/api/subscription-page-configs`                 |
| `DeleteSubscriptionPageConfigCommand`       | `DELETE` | `/api/subscription-page-configs/:uuid`           |
| `ReorderSubscriptionPageConfigsCommand`     | `POST`   | `/api/subscription-page-configs/actions/reorder` |
| `CloneSubscriptionPageConfigCommand`        | `POST`   | `/api/subscription-page-configs/actions/clone`   |
| `GetSubscriptionRequestHistoryCommand`      | `GET`    | `/api/subscription-request-history`              |
| `GetSubscriptionRequestHistoryStatsCommand` | `GET`    | `/api/subscription-request-history/stats`        |

### HWID

| Command                           | Method | Path                           |
| --------------------------------- | ------ | ------------------------------ |
| `GetAllHwidDevicesCommand`        | `GET`  | `/api/hwid/devices`            |
| `CreateUserHwidDeviceCommand`     | `POST` | `/api/hwid/devices`            |
| `GetUserHwidDevicesCommand`       | `GET`  | `/api/hwid/devices/:userUuid`  |
| `DeleteUserHwidDeviceCommand`     | `POST` | `/api/hwid/devices/delete`     |
| `DeleteAllUserHwidDevicesCommand` | `POST` | `/api/hwid/devices/delete-all` |
| `GetHwidDevicesStatsCommand`      | `GET`  | `/api/hwid/devices/stats`      |
| `GetTopUsersByHwidDevicesCommand` | `GET`  | `/api/hwid/devices/top-users`  |

### Infra Billing (CRM-adjacent)

| Command                                  | Method   | Path                                 |
| ---------------------------------------- | -------- | ------------------------------------ |
| `GetInfraProvidersCommand`               | `GET`    | `/api/infra-billing/providers`       |
| `CreateInfraProviderCommand`             | `POST`   | `/api/infra-billing/providers`       |
| `UpdateInfraProviderCommand`             | `PATCH`  | `/api/infra-billing/providers`       |
| `GetInfraProviderByUuidCommand`          | `GET`    | `/api/infra-billing/providers/:uuid` |
| `DeleteInfraProviderByUuidCommand`       | `DELETE` | `/api/infra-billing/providers/:uuid` |
| `GetInfraBillingNodesCommand`            | `GET`    | `/api/infra-billing/nodes`           |
| `CreateInfraBillingNodeCommand`          | `POST`   | `/api/infra-billing/nodes`           |
| `UpdateInfraBillingNodeCommand`          | `PATCH`  | `/api/infra-billing/nodes`           |
| `DeleteInfraBillingNodeByUuidCommand`    | `DELETE` | `/api/infra-billing/nodes/:uuid`     |
| `GetInfraBillingHistoryRecordsCommand`   | `GET`    | `/api/infra-billing/history`         |
| `CreateInfraBillingHistoryRecordCommand` | `POST`   | `/api/infra-billing/history`         |
| `DeleteInfraBillingHistoryRecordCommand` | `DELETE` | `/api/infra-billing/history/:uuid`   |

### Passkeys

| Command                                | Method   | Path                                 |
| -------------------------------------- | -------- | ------------------------------------ |
| `GetAllPasskeysCommand`                | `GET`    | `/api/passkeys`                      |
| `DeletePasskeyCommand`                 | `DELETE` | `/api/passkeys`                      |
| `UpdatePasskeyCommand`                 | `PATCH`  | `/api/passkeys`                      |
| `GetPasskeyRegistrationOptionsCommand` | `GET`    | `/api/passkeys/registration/options` |
| `VerifyPasskeyRegistrationCommand`     | `POST`   | `/api/passkeys/registration/verify`  |

### System / Keygen / Tools

| Command                        | Method | Path                                |
| ------------------------------ | ------ | ----------------------------------- |
| `GetPubKeyCommand`             | `GET`  | `/api/keygen`                       |
| `GetRemnawaveHealthCommand`    | `GET`  | `/api/system/health`                |
| `GetMetadataCommand`           | `GET`  | `/api/system/metadata`              |
| `GetStatsCommand`              | `GET`  | `/api/system/stats`                 |
| `GetBandwidthStatsCommand`     | `GET`  | `/api/system/stats/bandwidth`       |
| `GetNodesStatisticsCommand`    | `GET`  | `/api/system/stats/nodes`           |
| `GetNodesMetricsCommand`       | `GET`  | `/api/system/nodes/metrics`         |
| `GenerateX25519Command`        | `GET`  | `/api/system/tools/x25519/generate` |
| `EncryptHappCryptoLinkCommand` | `POST` | `/api/system/tools/happ/encrypt`    |
| `TestSrrMatcherCommand`        | `POST` | `/api/system/testers/srr-matcher`   |

### Bandwidth Stats

| Command                              | Method | Path                                            |
| ------------------------------------ | ------ | ----------------------------------------------- |
| `GetStatsNodesUsageCommand`          | `GET`  | `/api/bandwidth-stats/nodes`                    |
| `GetStatsNodesRealtimeUsageCommand`  | `GET`  | `/api/bandwidth-stats/nodes/realtime`           |
| `GetStatsNodeUsersUsageCommand`      | `GET`  | `/api/bandwidth-stats/nodes/:uuid/users`        |
| `GetStatsUserUsageCommand`           | `GET`  | `/api/bandwidth-stats/users/:uuid`              |
| `GetLegacyStatsNodeUserUsageCommand` | `GET`  | `/api/bandwidth-stats/nodes/:uuid/users/legacy` |
| `GetLegacyStatsUserUsageCommand`     | `GET`  | `/api/bandwidth-stats/users/:uuid/legacy`       |

### Snippets / Settings

| Command                          | Method   | Path                      |
| -------------------------------- | -------- | ------------------------- |
| `GetSnippetsCommand`             | `GET`    | `/api/snippets`           |
| `CreateSnippetCommand`           | `POST`   | `/api/snippets`           |
| `UpdateSnippetCommand`           | `PATCH`  | `/api/snippets`           |
| `DeleteSnippetCommand`           | `DELETE` | `/api/snippets`           |
| `GetRemnawaveSettingsCommand`    | `GET`    | `/api/remnawave-settings` |
| `UpdateRemnawaveSettingsCommand` | `PATCH`  | `/api/remnawave-settings` |

### CRM / Webhooks Types

There are no direct “payment webhook API commands” in the contract command list, but the package exports webhook event schemas/types:

- `RemnawaveWebhookEventSchema`
- `TRemnawaveWebhookEvent`
- Event constants under `EVENTS`/`EVENTS_SCOPES` (including `CRM` scope)

Example validation:

```ts
import { RemnawaveWebhookEventSchema } from '@remnawave/backend-contract';

const event = RemnawaveWebhookEventSchema.parse(req.body);
// now event.scope / event.event / event.data are typed
```

## Building a Telegram VPN Purchase Bot

Goal example:

- User pays `$5` for `20 GB / 30 days`
- Bot grants or extends Remnawave account
- Bot returns subscription/config link

### 1. Bot setup (`telegraf` or `grammy`)

- Keep Telegram user id as your stable customer key.
- Recommended username format for Remnawave user: `tg_<telegramId>` (valid chars and predictable lookup).

```ts
const remnawaveUsername = (telegramId: number) => `tg_${telegramId}`;
```

### 2. Show plans and handle payment

- Present plans in bot UI.
- Process payment with your external provider.
- After payment success (webhook or polling), call your Remnawave service function.

Plan conversion:

```ts
const PLAN_20GB_30D = {
  priceUsd: 5,
  trafficLimitBytes: 20 * 1024 * 1024 * 1024, // 20 GB
  durationDays: 30,
};
```

### 3. On payment success: create or update user

Important field mapping:

- Business `data_limit` -> contract `trafficLimitBytes`
- Business `expire_at` (unix) -> contract `expireAt` (ISO string)

```ts
import axios from 'axios';
import {
  CreateUserCommand,
  GetUserByUsernameCommand,
  UpdateUserCommand,
  USERS_STATUS,
  RESET_PERIODS,
} from '@remnawave/backend-contract';

const api = axios.create({
  baseURL: process.env.REMNAWAVE_BASE_URL!,
  headers: { Authorization: `Bearer ${process.env.REMNAWAVE_TOKEN}` },
});

async function grantOrExtendPlan(telegramId: number) {
  const username = `tg_${telegramId}`;
  const trafficLimitBytes = 20 * 1024 * 1024 * 1024;
  const expireAtUnix = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
  const expireAt = new Date(expireAtUnix * 1000).toISOString();

  try {
    const existing = await api.get<GetUserByUsernameCommand.Response>(
      GetUserByUsernameCommand.url(username),
    );

    const updated = await api.patch<UpdateUserCommand.Response>(UpdateUserCommand.url, {
      uuid: existing.data.response.uuid,
      trafficLimitBytes,
      expireAt,
      status: USERS_STATUS.ACTIVE,
      trafficLimitStrategy: RESET_PERIODS.NO_RESET,
      telegramId,
    } satisfies UpdateUserCommand.Request);

    return updated.data.response;
  } catch (e: any) {
    if (e?.response?.status !== 404) throw e;

    const created = await api.post<CreateUserCommand.Response>(CreateUserCommand.url, {
      username,
      trafficLimitBytes,
      expireAt,
      status: USERS_STATUS.ACTIVE,
      trafficLimitStrategy: RESET_PERIODS.NO_RESET,
      telegramId,
    } satisfies CreateUserCommand.Request);

    return created.data.response;
  }
}
```

### 4. Get subscription/config links and send to user

Preferred:

- `CreateUserCommand` / `UpdateUserCommand` response already includes `subscriptionUrl`.
  Optional richer info:
- `GetSubscriptionInfoByShortUuidCommand` gives `links`, `ssConfLinks`, usage, days left.

```ts
import { GetSubscriptionInfoByShortUuidCommand } from '@remnawave/backend-contract';

async function getLinks(shortUuid: string) {
  const res = await api.get<GetSubscriptionInfoByShortUuidCommand.Response>(
    GetSubscriptionInfoByShortUuidCommand.url(shortUuid),
  );
  return res.data.response; // { subscriptionUrl, links, ssConfLinks, ... }
}
```

Send message example:

```ts
const user = await grantOrExtendPlan(ctx.from.id);
await ctx.reply(`Plan activated.\nSubscription URL:\n${user.subscriptionUrl}`);
```

### 5. Optional automation (expiry / low traffic / reminders)

- Use cron/queue worker.
- Periodically call `GetAllUsersCommand` with filters.
- Apply:
  - `DisableUserCommand` for expired/non-renewed users
  - `UpdateUserCommand` to extend plans
  - `ResetUserTrafficCommand` if your business model requires manual resets
- Optionally consume Remnawave webhook events (typed with `RemnawaveWebhookEventSchema`) for reactive flows.

## Best Practices & Tips

- Version pinning:
  - Pin exact package version (for example `2.6.1`) and upgrade together with backend panel.
- Centralize API execution:
  - Build one `execCommand` helper for consistent auth headers, retries, and error formatting.
- Handle common errors explicitly:
  - `401`: invalid/expired token
  - `403`: insufficient role/permissions
  - `404`: user/resource not found
  - `400/422`: validation/schema mismatch
- Validate responses:
  - Use `Command.ResponseSchema.parse(...)` in critical payment flows.
- Respect limits and throughput:
  - Add queueing + backoff around bulk operations.
- Use contract naming, not custom field names:
  - `trafficLimitBytes`, `expireAt`, `telegramId`, `status`, etc.
- Be careful with date/units:
  - Convert unix seconds to ISO datetime before sending `expireAt`.
  - Always send traffic as bytes.
- Keep idempotency in payment webhooks:
  - Store payment event IDs and guard against duplicate grant calls.

## Links & References

- npm: https://www.npmjs.com/package/@remnawave/backend-contract
- Docs (TS SDK): https://docs.rw/docs/sdk/typescript-sdk
- OpenAPI / Swagger UI: https://docs.rw/api
- Main docs site: https://docs.rw/
- Backend repo: https://github.com/remnawave/backend
- Frontend repo: https://github.com/remnawave/frontend
- Subscription page repo: https://github.com/remnawave/subscription-page
