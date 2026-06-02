# Lemon Squeezy Setup

ClawDesk Windows 直售 Beta 固定使用 Lemon Squeezy 作為唯一付款與 license key 供應商。桌面 app 不保存信用卡資料、Lemon API key、webhook secret 或完整 license key。

## Approval Reply Pack

產生 Lemon 審核回覆與產品設定資料包：

```powershell
npm run lemon:onboarding:prepare
```

輸出位置：

```text
artifacts/lemon-onboarding/
```

內容包含：

- `lemon-reply-email.txt`
- `lemon-product-setup.md`
- `lemon-webhook-events.json`
- `lemon-env-checklist.md`
- 最近的 GUI / release / gateway 驗證報告與截圖

## Product

- Product name: ClawDesk
- Product type: downloadable Windows desktop software
- Publisher/developer: Alisonsoftware
- Website: `https://naviaworks.net/`
- Planned product page: `https://naviaworks.net/clawdesk`
- Support: `alison.ai.tech.studio@gmail.com`

## Variants

| Variant | Suggested price | Billing | Required env |
| --- | ---: | --- | --- |
| Pro Yearly | USD 79 | yearly subscription | `LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY` |
| Lifetime | USD 99 | one-time | `LEMON_SQUEEZY_VARIANT_ID_LIFETIME` |

## Webhook

URL:

```text
https://api.naviaworks.net/webhooks/lemon
```

Events:

- `order_created`
- `subscription_created`
- `subscription_updated`
- `subscription_cancelled`
- `license_key_created`
- `refund_created`

`subscription_cancelled` and `refund_created` must downgrade entitlement to `safe-mode`.

## Required Env

Fill these in `.env.production` after Lemon setup:

```text
LEMON_SQUEEZY_WEBHOOK_SECRET=
LEMON_SQUEEZY_STORE_ID=
LEMON_SQUEEZY_PRODUCT_ID=
LEMON_SQUEEZY_VARIANT_ID_PRO_YEARLY=
LEMON_SQUEEZY_VARIANT_ID_LIFETIME=
```

Validation:

```powershell
npm run beta:env:doctor
npm run verify:lemon:production
npm run beta:readiness
```

Never commit real Lemon values. Release reports only show key presence.
