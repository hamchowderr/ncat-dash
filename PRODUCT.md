# Product

<!-- impeccable:product-schema 1 -->

<!-- Written from the project's own records and Chowderr's recorded decisions (2026-11-15 to 2026-11-18), not from a fresh interview. -->

## Platform

web

## Users

Content creators and video editing agencies, and the small teams inside them. They want the clipping, captioning and organising of video to run by itself on their own server, with people stepping in only to approve or finish work in an editor.

## Product Purpose

Takewon is the interface the No-Code Architects Toolkit never had: a dashboard for building automations that run unattended on the customer's own self-hosted toolkit. AI (the agent) helps set automations up; plain, non-AI steps run them, so no AI tokens are spent on each video. Success is an automation that runs on its own, day after day.

## Positioning

Customers own their copy (one-time purchase, open source under AGPL-3.0, on the free GPL-2.0 toolkit) instead of renting a SaaS with per-video fees. Automations run inside the app itself; n8n is optional, never required.

## Operating Context

Teams work in the dashboard alongside Slack or Discord, approve clips in the Review room, and finish in Premiere Pro, DaVinci Resolve, Final Cut Pro or CapCut. The toolkit runs on a server or an always-on machine such as a Mac Mini.

## Capabilities and Constraints

- Automations are built on an n8n-like canvas; steps wire themselves, and nobody types placeholders or expressions.
- Set-once team information (logo, colour, font, music) lives in Settings and is pulled by steps automatically.
- Supports only Chowderr's fork of the toolkit.
- No Zapier or Make. No paid closed-source posting services. No text-to-video, AI dubbing or AI avatars.
- shadcnuikit is a design reference only; no kit code ships.

## Brand Commitments

- Light interface only; there is no dark mode.
- Nothing overlays anything; side panels push content aside. Transitions are seamless.
- No heavy box outlines or divider lines; separate areas with space and quiet tones.
- No sparkle or star "AI" icons. Real platform logos, never stand-ins.
- Plain, everyday words in the interface; no jargon.

## Evidence on Hand

Explainer videos and screen recordings live in the project files. No product name and no price are set yet; do not invent either.

## Product Principles

1. An automation runs by itself; the interface exists to set it up and watch it.
2. Ask for information once, in Settings or onboarding, and never again per step.
3. Familiar patterns from well-regarded tools (Linear, Vercel, n8n) over invented ones.
4. Every change ships with automated tests and a real recording from a production build.
