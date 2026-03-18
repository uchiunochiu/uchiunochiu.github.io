# Tachikoma Mobile Design System v1

> Inspired by modern Japanese fintech app clarity, but fully original.

## 1) Brand Direction
- **Keywords**: Crisp, trustworthy, energetic, compact, human.
- **Tone**: High-contrast minimal + warm accents.
- **Do Not**: Reuse PayPay logo shapes, icon glyphs, screenshots, exact token values, or identical layout composition.

## 2) Core Principles
1. **One-screen completion**: critical actions must be reachable within one thumb zone.
2. **Status-first UI**: balance, transaction state, and errors are always visible.
3. **Fast confidence**: clear feedback within 100–200ms (pressed/hover/loading states).
4. **Consistency over novelty**: keep spacing, radius, and typography rhythm strict.

## 3) Design Tokens (Canonical)
Use only tokens from `tokens.json`.
- Color system: neutral base + coral-red accent + semantic status colors.
- 8pt spacing scale.
- 3 radius tiers (card/chip/button).
- Typography with Japanese-first readability.

## 4) Component Set (Mobile-first)
### Foundations
- AppShell, TopBar, BottomNav, SafeAreaContainer
- Surface (elevated/flat), Divider, SectionHeader

### Inputs
- TextField, AmountField, SearchField
- SegmentedControl, Toggle, RadioCard, Checkbox

### Actions
- PrimaryButton, SecondaryButton, GhostButton, IconButton
- FAB (single purpose only)

### Feedback
- InlineError, Banner, Toast, EmptyState, Skeleton
- ProgressRing, ProgressBar, StatusBadge

### Financial Patterns
- BalanceCard
- TransactionRow
- KPIChip
- ConfirmSheet (amount + fee + final total)

## 5) Layout Rules
- Base grid: 4pt internal, 8pt external rhythm.
- Horizontal page padding: 16pt.
- Card stack gap: 12pt.
- Primary CTA fixed at bottom for action-heavy flows.

## 6) Motion Rules
- Duration: 120 / 180 / 240ms
- Easing: standard `cubic-bezier(0.2, 0.8, 0.2, 1)`
- Use motion for state change clarity, not decoration.

## 7) Accessibility Rules
- Minimum tap target: 44x44.
- Minimum text contrast: WCAG AA.
- Amount and critical status must not rely on color only.

## 8) Assistant Build Contract (for Tachikoma)
When user asks to design/build mobile UI and does not override style:
1. Load this design system.
2. Use `tokens.json` values only.
3. Use component names from this document.
4. Include brief token mapping section in output.
5. If user requests “PayPay-like”, keep only abstract qualities (clarity/speed/trust), never direct visual copy.

## 9) Example Prompt Snippet
"Use Tachikoma Mobile Design System v1 in `design-system/`. Build mobile-first screens with defined tokens/components only."
