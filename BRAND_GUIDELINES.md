# ETIHAD PRIME SUPPLIES — Brand & ERP Design Guidelines

These are the approved brand-design tokens for the Etihad Traders ERP/POS project as it transitions to the **ETIHAD PRIME SUPPLIES** identity.

## Brand identity

- Brand name: **ETIHAD PRIME SUPPLIES**
- Urdu name: **اتحاد پرائم سپلائز**
- Descriptor: **GENERAL TRADING & WHOLESALE**
- Visual direction: modern, minimal, premium, professional.
- Core identity: matte black + metallic gold, with white for clear readable text.

## Core brand colours

| Token | Name | HEX | Intended use |
|---|---|---|---|
| Brand black | Pure Black | `#000000` | Main dark surfaces, header/footer, primary logo background |
| Brand gold | Metallic Gold | `#D4AF37` | Primary brand accent, key buttons, active states, highlights |
| Brand white | Premium White | `#F5F5F5` | Text on dark surfaces, light surfaces, high-contrast content |

## Supporting gold and dark shades

| Token | Name | HEX | Intended use |
|---|---|---|---|
| Gold 700 | Antique Gold | `#936511` | Deep gold borders, shadows, subdued accents |
| Gold 600 | Deep Gold | `#BF8516` | Secondary accents, borders, gradients |
| Gold 500 | Rich Gold | `#ECAD21` | Secondary emphasis and decorative highlights |
| Gold 400 | Bright Gold | `#F8D14E` | Hover/shine details and small highlights |
| Gold 200 | Champagne Highlight | `#FAEB8B` | Subtle metallic highlight only; avoid long text |
| Dark Gold | Black Gold | `#161002` | Warm dark panels and deep gradient stops |

## CSS custom properties

Use these tokens centrally rather than hardcoding different gold/black values across components:

```css
:root {
  --brand-black: #000000;
  --brand-gold: #D4AF37;
  --brand-white: #F5F5F5;

  --brand-gold-antique: #936511;
  --brand-gold-deep: #BF8516;
  --brand-gold-rich: #ECAD21;
  --brand-gold-bright: #F8D14E;
  --brand-gold-champagne: #FAEB8B;
  --brand-black-gold: #161002;

  --erp-bg: #000000;
  --erp-surface: #161002;
  --erp-primary: #D4AF37;
  --erp-primary-hover: #BF8516;
  --erp-text: #F5F5F5;
  --erp-border: #936511;
}
```

## ERP/POS application guidance

1. Keep the interface clean, modern, and practical. The ERP is a working business tool, not a decorative marketing page.
2. Use black for the main dark shell and navigation; use warm dark panels (`#161002`) to distinguish cards and sections.
3. Use metallic gold (`#D4AF37`) consistently for primary actions, selected navigation, important totals, and active indicators.
4. Use white (`#F5F5F5`) for readable text on dark surfaces. Use black text on gold-filled buttons and badges.
5. Use antique/deep gold for borders and secondary accents. Reserve bright/champagne gold for small highlights, not large areas of text.
6. Keep status colours semantically distinct: success, warning, error, and informational states must remain recognizable and must not all become gold.
7. Maintain accessible contrast and clear focus indicators. Do not put small white text on bright gold or small gold text on white if contrast is weak.
8. Apply the identity consistently to desktop, mobile, tablet, Chromebook, installed PWA, POS screens, login, receipts, invoices, and print views.
9. Use subtle gold gradients only for selected premium elements; keep most interface surfaces flat for speed, clarity, and reliable rendering.
10. Preserve all existing ERP functionality, data, offline/PWA behavior, authentication, and synchronization while applying visual changes. Do not alter database records or business logic as part of a colour-only redesign.

## Suggested component styling

- Primary button: background `#D4AF37`, text `#000000`; hover `#BF8516`.
- Secondary button: transparent or `#161002` background, `#D4AF37` border/text.
- Main page: `#000000`; card/panel: `#161002`.
- Main text: `#F5F5F5`; muted text: a suitably contrast-tested neutral grey.
- Active navigation: gold text or a restrained gold left border/indicator.
- Inputs: dark surface, readable white text, subtle gold focus border.
- Financial totals: use gold for emphasis, but retain clear labels and numeric readability.

## Brand consistency rule

**Black is the foundation. Gold is the signature accent. White is for clarity.** Use the same palette and hierarchy throughout the product. Do not introduce unrelated accent colours into the core brand identity.

