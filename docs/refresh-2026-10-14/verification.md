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
