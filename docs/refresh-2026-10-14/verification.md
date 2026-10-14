# 2026-10-14 game refresh

## Batch 1: archive and bridge icon

- Base: origin/main 20cd879783cf4e0b05f7de717129bb47005dbaf1; isolated worktree. No AGENTS.md or .agents/skills in this repository or its workspace ancestors.
- 15 active entries; Tux 2D and Flip Five retained at original URLs and listed in archive.html. Both archived games link to archive and home.
- Original SVG overlapping bridge hand with spade; same shared icon on catalogue and game.
- 73 applicable Node checks passed (icons, visual contract, Tux, Flip Five, bridge).
- Chromium and WebKit: desktop 1440×1000, portrait 390×844 and 320×568, landscape 844×390; catalogue routing, old URLs, return links, no page errors or horizontal overflow. Screenshot review of archive and bridge performed. See batch1.json.
- No physical iPhone tested. Browser viewports emulate layout/touch; they do not prove device performance.

Batch 1 publication: 55716e2 pushed normally; Pages succeeded and public Chromium/WebKit catalogue checks passed at https://yfwu.dev/FuGames/archive.html. Initial rules CI exposed an old all-HTML-is-a-game assertion; the archive is now correctly classified as a catalogue. No gameplay assertion removed.

## Batch 2: effect snake

- Same grid steering, five readable food effects and three public-board AI personalities retained.
- 90-second contest ranks food score + surviving target length ×10; player death still ends the run. Equal top totals tie. AI respawns with reset score, as documented.
- Hold Space / boost button: requires mass >=6 and no slow; double movement, costs one mass every .32 seconds and drops edible fruit. The same AI boost decision pays the same cost. Mass capped at 30.
- Only competing for the same empty cell grants a mass advantage: >=1.5× every opponent and none has a shield. All body collisions remain dangerous. Winner gets +30 score / +2 growth; shield is a counter.
- 18 rule checks pass, including mass cost, shield counter, timeout and eight bounded deterministic matches (reduced from the old 30 long runs).
- Eight Chromium/WebKit viewport checks pass: actual steering and held boost in a controlled open-board fixture, freeze/resume and three repeated restarts; no JS errors or horizontal overflow. Portrait and landscape screenshots reviewed. No physical iPhone test.

## Batch 3: pulse arena

- Existing motion, inertia, charge/release and shrink timings retained.
- Public pickups start at 3s, then every 8s, capacity 3 on the field / 1 held; all four types cycle. E or the item button uses one item, with held-input edge gating.
- Anchor resists impulses/attraction for 5s (shrinking ring still eliminates). Super pulse warns for .6s then blasts once at range 200. Shield lasts 12s and saves exactly one boundary crossing. Black hole warns .7s then attracts opponents for 5s within 145 units.
- Visible item inventory, timer rings and warning areas; AI collects items, uses them when publicly threatened and avoids warned supers/holes. No hidden hands exist.
- 17 Node tests pass including original physics plus one-use, warning, freeze and counter behavior; eight Chromium/WebKit viewport/control checks pass. Portrait and landscape screenshots reviewed. No physical iPhone test.

Public checkpoint: b055425 (snake) and 6804b67 (pulse) rules CI succeeded; Pages for 6804b67 succeeded and includes both. Both public game URLs passed the same eight browser/viewports, including actual control input and controlled tactical fixtures (see *-live.json). The superseded b055425 Pages run was cancelled by the newer deployment, not a deployment failure.

## Batch 4: Steel Core / original burrow artillery

- Replaced continuous tank controls with two worms per team, alternating turns and alternating surviving units. Original vector/canvas character art; no third-party game assets.
- Large angle/power sliders and left/right move buttons, full public wind-aware trajectory, 60 movement per turn, no aiming timer. One shot or pass ends the turn. Physics segment substeps catch thin walls.
- Draw one card per turn up to three; play at most one. Wall (36 HP), bunker (40 HP / half friendly splash within 85), repair (+20), drill (larger crater / reduced blast damage). Buildings restricted to nearby empty ground, destructible and block movement/low shots. Friendly fire and crater fall damage apply equally.
- AI uses its own cards and a public observation, 165 angle/power candidates, and identical projectile physics. Hidden opponent hands/RNG are absent from its shot observation. Tests show changing opponent hands cannot alter the decision.
- Team elimination ends match; after 40 turns compare total HP, ties draw. Pause freezes AI/projectiles; restart resets the entire match.
- New rules suite replaces the obsolete real-time-tank tests: 9 focused tests, including two bounded complete autonomous matches. Related visual integration passed; final whole repository run: 415 / 415 pass. After the final icon/label edit, tank+icon checks: 15 / 15 pass. git diff --check clean.
- Chromium and WebKit, 1440×1000 / 390×844 / 844×390 / 320×568: start, aiming, movement, actual touch placement on mobile contexts, invalid placement without card loss, shot/AI/player turn, flight pause, three restarts; no errors/overflow. The landscape control panel scrolls separately. Screenshot examples use explicitly controlled tactical scenes, not balance evidence.
- No physical iPhone was tested; emulated viewports and desktop WebKit do not establish iOS performance or every multi-touch behavior. Real-time hold inputs used browser pointer controls; mobile building placement used touchscreen taps.

## Separate proposal

[Three-layer cyclic tic-tac-toe](cyclic-3d-proposal.md) records current FIFO rules, a readable 3×3×3 / 49-line proposal, pie-rule selection, exact queue-aware repetition, a 120-ply cap and a bounded testing plan. Geometry was enumerated (49 unique lines, center 13, corner 7). No 3D gameplay or balance claim, and cyclic_tictactoe.html was not modified.
