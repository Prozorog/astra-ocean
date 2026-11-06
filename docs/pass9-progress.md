# Pass 9 review state

Main tile 5 and the dark colour/reduced reflections are locked. Storm is tile 3. Rounds 2-4 are cancelled. Sources were checkpointed before edits at output/checkpoints/pass9-start-20261104-180850/sources.zip.

Implemented: shared-seed spectrum morph, exact anchor foam caches, smooth anchor hand-off, background Storm cache, guarded persistent Settings, gear/G navigation, old main F entry removal. Live rendering uses one evolve, ping-pong history, one MSAA scene target, exact-zero blur early-out, depth prepass/culling, paused idle skipping and GPU backpressure. Quality-changing MRT/direct-restore/.5px-cutoff candidates were rejected.

All 126 final golden images meet +/-1/255. Main/Storm match the original tile PNGs within 1/255; Main/Storm/middle seams are pixel-identical. Live 30fps velocity is identical; 20/60fps differences disappear completely with blur off. Paused velocity is bit-identical.

Typecheck, both builds/notices, unchanged lab, surface, desktop/mobile inputs/Settings, snapshot/record, Main/Storm GPU ball traces and built-output browser smoke pass. The native hidden state could not be induced in this automation browser; its visibility handler was tested with an emulated hidden event. The live MediaRecorder endpoint differs slightly from its wall-clock period; exact frozen exports remain 121 frames/3.63s.

Final Iris Xe: 1080p 18.90 -> 22.24fps; 720p 32.92 -> 41.06fps. Opening 1866 -> 1134ms at 1080p; 1288 -> 1019ms at 720p. The 45fps/frame-time/loading soft targets are not all met. REPORT.md contains full per-pass measurements, every remaining limit and quality-cost options not applied.

Ready for the user's single final eye-review STOP after own-cleanup; keep port 4103 running. No subagents were spawned and no external-project files were deleted.
