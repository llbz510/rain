Rain local-only backup snapshot (rollback point)
created       : 2026-09-27 10:22 +08:00
source repo   : D:\xiangmu\rain 未完成
local master  : 7dd3be0  (behind GitHub by 28 commits)
github master : 4ed97fb  (tag backup/master-20260927-1022 points here)
base commit   : 55d121f  Enable NSIS GPU release bundle  (existed only on this PC)
stash commit  : ad1d95d  WIP: record user-cancelled remote build

What was NOT yet on GitHub before this backup
--------------------------------------------
1. commit 55d121f on branch codex/m3-s2-nsis-artifact-generator
   files: docs/PROJECT_STATE.md, docs/development/agent-first-development-plan.md,
          docs/development/rain-project-delivery-plan.md,
          scripts/gpu-release-bundle.test.ts, src-tauri/tauri.gpu.conf.json
2. stash ad1d95d (uncommitted work-in-progress)
   -> full patch saved as stash-remote-build-cancellation.patch

Dirty worktrees: verified to contain NO real content change
----------------------------------------------------------
  codex/ac-vl-05-thumbnail-delete (2480): src-tauri/gen/schemas/*.json
  codex/pr59-closeout            (b304): src/pages/StudyInterface.tsx
  For every such file the index blob equals the HEAD blob and
  "git diff" is empty; "git status" only reported a CRLF line-ending
  difference caused by core.autocrlf=true. Nothing was lost, therefore
  no patch files are stored here.

How to roll back
----------------
  git fetch origin
  git checkout backup/local-snapshot-20260927-1022          # whole point-in-time
  git checkout backup/m3-s2-nsis-artifact-generator-20260927-1022
  git checkout backup/stash-remote-build-cancellation-20260927-1022
  git cherry-pick 55d121f                                   # single commit
  git stash apply ad1d95d                                   # restore WIP
