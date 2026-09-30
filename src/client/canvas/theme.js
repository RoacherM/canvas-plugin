/**
 * Canvas look, after LibTV's canvas: a dark dotted board, quiet cards with the title above them,
 * frosted floating controls with hairline borders, round "+" handles that show on hover, and a white
 * round submit button. Both palettes carry LibTV's own token values; `dshc-dark` / `dshc-light` on the
 * root pick one (following the DSH theme unless the user chose).
 */
export const css = `
  .dshc-root.dshc-dark {
    --c-bg:#141414; --c-dot:#3d3d3d; --c-node:#191e26; --c-node-border:#363636; --c-node-sel:#a8a8a8;
    --c-handle:#86909c; --c-handle-bg:#1e1e1ee6; --c-handle-icon:#ffffffb3;
    --c-edge:#86909c; --c-edge-hover:#c0c8d0; --c-edge-sel:#e0e4e8;
    --c-ctl-bg:#262626; --c-ctl-border:#363636; --c-text:#fff; --c-text-2:#ffffffd9; --c-muted:#919191; --c-icon:#ffffffd9;
    --c-hover:#ffffff1a; --c-active:#ffffff26; --c-soft:#ffffff0d; --c-line:#ffffff14; --c-input:#ffffff0f;
    --c-minimap-bg:#1f1f1fe6; --c-minimap-mask:#ffffff0a; --c-minimap-node:#525252;
    --c-shadow-panel:0 2px 5px #00000026; --c-shadow-dropdown:0 4px 10px #00000040, 0 2px 4px #0000004d; --c-shadow-menu:0 8px 32px #00000026, 0 2px 8px #0000001a;
    --c-primary-bg:#ffffffe6; --c-primary-hover:#ffffffb3; --c-primary-fg:#141414;
    --c-selection:#ffffff0f; --c-group-bg:#ffffff0d; --c-group-border:#ffffff1a;
    --c-brand:#13d5ff; --c-brand-text:#5ddcff; --c-brand-surface:#13d5ff1f; --c-danger:#ff8a7a; --c-scrim:#00000073;
  }
  .dshc-root.dshc-light {
    --c-bg:#f5f5f5; --c-dot:#d6d6d6; --c-node:#fff; --c-node-border:#e3e3e3; --c-node-sel:#919191;
    --c-handle:#919191; --c-handle-bg:#fff; --c-handle-icon:#000000b3;
    --c-edge:#c4c4c4; --c-edge-hover:#919191; --c-edge-sel:#525252;
    --c-ctl-bg:#fff; --c-ctl-border:#0000000f; --c-text:#262626; --c-text-2:#262626d9; --c-muted:#919191; --c-icon:#262626;
    --c-hover:#0000000d; --c-active:#00000014; --c-soft:#00000008; --c-line:#0000000f; --c-input:#0000000a;
    --c-minimap-bg:#ededede6; --c-minimap-mask:#0000000a; --c-minimap-node:#c4c4c4;
    --c-shadow-panel:0 2px 5px #00000014; --c-shadow-dropdown:0 4px 10px #0000001f, 0 2px 4px #0000000f; --c-shadow-menu:0 8px 32px #00000014, 0 2px 8px #0000000a;
    --c-primary-bg:#000000d9; --c-primary-hover:#000000b3; --c-primary-fg:#fff;
    --c-selection:#0000000f; --c-group-bg:#0000000a; --c-group-border:#00000014;
    --c-brand:#05a3c5; --c-brand-text:#05a3c5; --c-brand-surface:#3cb5cc1a; --c-danger:#d64538; --c-scrim:#00000040;
  }

  .dshc-root { container:dshc / inline-size; position:relative; width:100%; height:100%; min-height:320px; overflow:hidden; background:var(--c-bg); color:var(--c-text); font-size:13px;
    font-family:-apple-system, BlinkMacSystemFont, "PingFang SC", Inter, "Noto Sans SC", "Microsoft YaHei", sans-serif; -webkit-font-smoothing:antialiased; }
  .dshc-root .react-flow { --xy-background-color:var(--c-bg); --xy-background-pattern-color:var(--c-dot); --xy-edge-stroke:var(--c-edge); --xy-edge-stroke-width:1.5;
    --xy-edge-stroke-selected:var(--c-edge-sel); --xy-connectionline-stroke:var(--c-edge-sel); --xy-connectionline-stroke-width:1.5;
    --xy-selection-background-color:var(--c-selection); --xy-selection-border:1px solid var(--c-node-sel);
    --xy-minimap-background-color:var(--c-minimap-bg); --xy-minimap-mask-background-color:var(--c-minimap-mask); --xy-minimap-node-background-color:var(--c-minimap-node);
    --xy-edge-label-background-color:var(--c-ctl-bg); --xy-edge-label-color:var(--c-muted); --xy-attribution-background-color:transparent; }
  .dshc-root .react-flow__node { font-size:13px; color:var(--c-text); }
  .dshc-root .react-flow__node-frame { z-index:-1; }
  .dshc-root button { font:inherit; }
  .dshc-icon { flex:none; display:block; }

  /* ── Floating chrome ── */
  .dshc-float { border:.5px solid var(--c-ctl-border); border-radius:12px; background:color-mix(in srgb, var(--c-ctl-bg) 94%, transparent);
    box-shadow:var(--c-shadow-dropdown); backdrop-filter:blur(12px); -webkit-backdrop-filter:blur(12px); color:var(--c-text); }
  .dshc-ibtn { display:inline-flex; align-items:center; justify-content:center; flex:none; width:32px; height:32px; padding:0; border:none; border-radius:8px;
    background:transparent; color:var(--c-icon); cursor:pointer; transition:background .15s, color .15s; position:relative; }
  .dshc-ibtn:hover:not(:disabled) { background:var(--c-hover); }
  .dshc-ibtn[aria-pressed="true"], .dshc-ibtn.on { background:var(--c-active); color:var(--c-text); }
  .dshc-ibtn:disabled { opacity:.35; cursor:not-allowed; }
  .dshc-ibtn .dot { position:absolute; top:6px; right:6px; width:6px; height:6px; border-radius:50%; background:var(--c-danger); }
  .dshc-tbtn { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 10px; border:none; border-radius:8px; background:transparent;
    color:var(--c-text); font-size:13px; white-space:nowrap; cursor:pointer; transition:background .15s; }
  .dshc-tbtn:hover:not(:disabled) { background:var(--c-hover); }
  .dshc-tbtn:disabled { opacity:.4; cursor:not-allowed; }
  .dshc-tbtn .dshc-icon { color:var(--c-icon); }
  .dshc-sep { flex:none; width:0; height:16px; margin:0 4px; border-left:.5px solid var(--c-ctl-border); }
  .dshc-root .react-flow__panel { margin:12px; }

  .dshc-topbar { display:flex; align-items:center; gap:2px; box-sizing:border-box; min-height:42px; padding:4px; }
  .dshc-topbar .name { max-width:180px; padding:0 8px; overflow:hidden; font-size:13px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
  .dshc-save { display:inline-flex; align-items:center; gap:5px; padding:0 8px 0 2px; color:var(--c-muted); font-size:12px; white-space:nowrap; }
  .dshc-save i { width:6px; height:6px; border-radius:50%; background:#2ecc71; }
  .dshc-save.pending i, .dshc-save.saving i { background:#f4b740; }
  .dshc-save.failed { color:var(--c-danger); } .dshc-save.failed i { background:var(--c-danger); }
  .dshc-actions { display:flex; align-items:center; gap:2px; padding:4px; }
  .dshc-actions .count { min-width:16px; height:16px; padding:0 4px; border-radius:8px; background:var(--c-primary-bg); color:var(--c-primary-fg); font-size:11px; line-height:16px; text-align:center; }

  .dshc-bottom { display:flex; flex-direction:column; align-items:center; gap:8px; }
  .dshc-dock { display:flex; align-items:center; gap:2px; padding:4px; }
  .dshc-dock .add { width:auto; padding:0 12px 0 8px; gap:4px; font-size:13px; color:var(--c-text); }
  .dshc-controls { display:flex; align-items:center; gap:2px; padding:4px; }
  .dshc-zoom { min-width:46px; height:32px; padding:0 4px; border:none; border-radius:8px; background:transparent; color:var(--c-text); font-size:12px; font-variant-numeric:tabular-nums; cursor:pointer; }
  .dshc-zoom:hover { background:var(--c-hover); }
  .dshc-root .react-flow__minimap.dshc-minimap { margin-bottom:60px; overflow:hidden; border:.5px solid var(--c-ctl-border); border-radius:12px; box-shadow:var(--c-shadow-panel); }
  .dshc-toast { max-width:min(520px, 80vw); padding:8px 14px; font-size:12px; line-height:1.5; }
  .dshc-pop { position:absolute; bottom:calc(100% + 8px); padding:10px 12px; min-width:220px; font-size:12px; }
  .dshc-pop h4 { margin:0 0 8px; font-size:12px; font-weight:600; color:var(--c-muted); }
  .dshc-pop dl { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin:0; }
  .dshc-pop dt { color:var(--c-text); white-space:nowrap; }
  .dshc-pop dd { margin:0; color:var(--c-muted); }
  .dshc-pop kbd { display:inline-block; min-width:18px; padding:1px 5px; border-radius:5px; background:var(--c-hover); font:inherit; font-size:11px; text-align:center; }

  /* ── Add-node menu ── */
  .dshc-menu { position:absolute; z-index:15; display:flex; flex-direction:column; gap:2px; box-sizing:border-box; width:248px; padding:6px; box-shadow:var(--c-shadow-menu); }
  .dshc-menu .title { padding:6px 8px 4px; color:var(--c-muted); font-size:12px; }
  .dshc-menu .group { padding:8px 8px 2px; margin-top:2px; border-top:.5px solid var(--c-ctl-border); color:var(--c-muted); font-size:12px; }
  .dshc-menu button { display:flex; align-items:center; gap:10px; height:40px; padding:0 6px; border:none; border-radius:8px; background:transparent; color:var(--c-text); font-size:13px; text-align:left; cursor:pointer; }
  .dshc-menu button:hover, .dshc-menu button:focus-visible { background:var(--c-hover); outline:none; }
  .dshc-menu .ico { display:flex; align-items:center; justify-content:center; flex:none; width:28px; height:28px; border-radius:8px; background:var(--c-soft); color:var(--c-icon); }
  .dshc-menu .label { flex:1; min-width:0; }
  .dshc-menu small { color:var(--c-muted); font-size:11px; white-space:nowrap; }

  /* ── Empty canvas guide ── */
  .dshc-guide { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; pointer-events:none; text-align:center; }
  .dshc-guide strong { font-size:16px; font-weight:600; }
  .dshc-guide span { color:var(--c-muted); font-size:13px; }
  .dshc-guide .chips { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:14px; max-width:520px; pointer-events:auto; }
  .dshc-guide .chips button { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 12px; border:.5px solid var(--c-ctl-border); border-radius:999px;
    background:var(--c-ctl-bg); color:var(--c-text); font-size:13px; cursor:pointer; box-shadow:var(--c-shadow-panel); }
  .dshc-guide .chips button:hover { background:color-mix(in srgb, var(--c-ctl-bg) 80%, var(--c-text)); }

  /* ── Nodes ── */
  .dshc-card { position:relative; width:100%; height:100%; box-sizing:border-box; border:1px solid var(--c-node-border); border-radius:12px; background:var(--c-node); transition:border-color .15s; }
  .dshc-card.is-selected { border-color:var(--c-node-sel); box-shadow:0 0 0 1px var(--c-node-sel); }
  .dshc-node-title { position:absolute; left:2px; right:0; bottom:calc(100% + 6px); display:flex; align-items:center; gap:6px; min-width:0; color:var(--c-muted); font-size:12px; line-height:18px; white-space:nowrap; pointer-events:none; }
  .dshc-node-title .name { overflow:hidden; color:var(--c-text-2); text-overflow:ellipsis; }
  .dshc-node-title .meta { flex:none; color:var(--c-muted); }
  .dshc-node-title input { min-width:40px; max-width:100%; padding:0 2px; border:none; border-radius:4px; background:transparent; color:var(--c-text-2); font:inherit; outline:none; pointer-events:auto; }
  .dshc-node-title input:focus { background:var(--c-hover); }
  .dshc-badge { flex:none; height:16px; padding:0 5px; border-radius:4px; background:var(--c-brand-surface); color:var(--c-brand-text); font-size:10px; font-weight:600; line-height:16px; letter-spacing:.3px; }
  .dshc-media { overflow:visible; }
  .dshc-media img, .dshc-media video { display:block; width:100%; height:100%; object-fit:cover; border-radius:11px; }
  .dshc-media video { object-fit:contain; background:#000; }
  .dshc-media.is-empty { background:var(--c-node); }
  .dshc-missing { display:flex; align-items:center; justify-content:center; height:100%; padding:8px; color:var(--c-muted); font-size:12px; word-break:break-all; text-align:center; }
  .dshc-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; height:100%; padding:16px; box-sizing:border-box; color:var(--c-muted); font-size:12px; text-align:center; }
  .dshc-placeholder .dshc-icon { color:var(--c-muted); opacity:.8; }
  .dshc-hints { display:flex; flex-wrap:wrap; justify-content:center; gap:6px; }
  .dshc-hints span { padding:3px 8px; border-radius:6px; background:var(--c-soft); color:var(--c-text-2); font-size:11px; }
  .dshc-versions { position:absolute; right:8px; bottom:8px; display:flex; align-items:center; gap:2px; padding:2px; border-radius:8px; background:rgba(20,20,20,.62); color:#fff; font-size:11px; backdrop-filter:blur(8px); -webkit-backdrop-filter:blur(8px); }
  .dshc-versions span { padding:0 2px; font-variant-numeric:tabular-nums; }
  .dshc-versions button { display:flex; align-items:center; justify-content:center; width:20px; height:20px; padding:0; border:none; border-radius:6px; background:transparent; color:#fff; cursor:pointer; }
  .dshc-versions button:hover:not(:disabled) { background:#ffffff26; }
  .dshc-versions button:disabled { opacity:.3; cursor:default; }
  .dshc-running { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:8px; border-radius:11px; background:rgba(10,12,16,.55); color:#fff; font-size:12px; pointer-events:none; backdrop-filter:blur(2px); }
  .dshc-spin { width:18px; height:18px; border:2px solid rgba(255,255,255,.28); border-top-color:#fff; border-radius:50%; animation:dshc-spin .8s linear infinite; }
  @keyframes dshc-spin { to { transform:rotate(360deg); } }

  /* ── Handles: round "+" buttons outside the card, shown on hover, selection and while connecting ── */
  .dshc-root .react-flow__handle.dshc-handle { width:22px; height:22px; min-width:0; min-height:0; border:1px solid var(--c-node-border); border-radius:50%;
    background:var(--c-handle-bg); color:var(--c-handle-icon); opacity:0; transition:opacity .15s, border-color .15s; }
  .dshc-root .react-flow__handle-left.dshc-handle { left:-15px; }
  .dshc-root .react-flow__handle-right.dshc-handle { right:-15px; }
  .dshc-root .react-flow__node:hover .dshc-handle, .dshc-root .react-flow__node.selected .dshc-handle, .dshc-root.is-connecting .dshc-handle.target { opacity:1; }
  .dshc-root .react-flow__handle.dshc-handle:hover { border-color:var(--c-node-sel); }
  .dshc-root .react-flow__handle.dshc-handle.source::before, .dshc-root .react-flow__handle.dshc-handle.source::after { content:""; position:absolute; left:50%; top:50%; width:10px; height:1.5px; border-radius:1px; background:currentColor; transform:translate(-50%, -50%); pointer-events:none; }
  .dshc-root .react-flow__handle.dshc-handle.source::after { transform:translate(-50%, -50%) rotate(90deg); }
  .dshc-root .react-flow__handle.dshc-handle.target::after { content:""; position:absolute; left:50%; top:50%; width:8px; height:8px; border-radius:50%; background:var(--dot, var(--c-handle)); transform:translate(-50%, -50%); pointer-events:none; }
  .dshc-root .dshc-handle-first { --dot:#2ecc71; } .dshc-root .dshc-handle-last { --dot:#f28a2e; } .dshc-root .dshc-handle-ref { --dot:#84adff; }
  .dshc-root .react-flow__handle.dshc-handle-in { opacity:0 !important; pointer-events:none; width:1px; height:1px; border:none; }
  .dshc-root .react-flow__handle.valid { border-color:var(--c-brand); }

  /* ── Edges ── */
  .dshc-root .react-flow__edge-path { stroke-linecap:round; }
  .dshc-root .react-flow__edge:hover .react-flow__edge-path { stroke:var(--c-edge-hover); }
  .dshc-root .react-flow__edge.selected .react-flow__edge-path { stroke:var(--c-edge-sel); }
  .dshc-root .react-flow__edge.role-output .react-flow__edge-path { stroke-dasharray:4 4; opacity:.6; }
  .dshc-root .react-flow__edge.role-shot .react-flow__edge-path { stroke-dasharray:2 5; opacity:.7; }
  .dshc-root .react-flow__edge-text { font-size:11px; fill:var(--c-muted); }

  /* ── Node toolbar (above) and generation panel (below) ── */
  .dshc-nodebar { display:flex; align-items:center; gap:2px; padding:4px; }
  .dshc-panel { display:flex; flex-direction:column; gap:8px; box-sizing:border-box; width:min(480px, calc(100cqw - 24px)); padding:12px; border-radius:16px; background:var(--c-ctl-bg); box-shadow:var(--c-shadow-menu); font-size:13px; }
  .dshc-panel-top { display:flex; align-items:center; gap:6px; min-height:24px; }
  .dshc-panel-top strong { font-size:12px; font-weight:500; color:var(--c-muted); }
  .dshc-panel-top .status { flex:1; min-width:0; overflow:hidden; color:var(--c-muted); font-size:12px; text-align:right; white-space:nowrap; text-overflow:ellipsis; }
  .dshc-panel-top .status.error { color:var(--c-danger); }
  .dshc-chips { display:flex; flex-wrap:wrap; gap:4px; }
  .dshc-chip { display:inline-flex; align-items:center; gap:4px; height:22px; padding:0 8px; border:none; border-radius:6px; background:var(--c-soft); color:var(--c-text-2); font-size:11px; white-space:nowrap; }
  button.dshc-chip { cursor:pointer; }
  button.dshc-chip[aria-pressed="true"] { background:var(--c-brand-surface); color:var(--c-brand-text); }
  button.dshc-chip[aria-pressed="false"] { text-decoration:line-through; opacity:.7; }
  .dshc-panel textarea { width:100%; min-height:64px; box-sizing:border-box; padding:2px 2px; border:none; background:transparent; color:var(--c-text); font:inherit; font-size:13px; line-height:1.6; resize:none; outline:none; }
  .dshc-panel textarea::placeholder, .dshc-prompt::placeholder { color:var(--c-muted); }
  .dshc-panel-bottom { display:flex; align-items:center; gap:6px; }
  .dshc-panel-bottom .dshc-pills { flex:1; min-width:0; }
  .dshc-pills { display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
  .dshc-pill { position:relative; display:inline-flex; align-items:center; height:28px; border-radius:8px; background:var(--c-hover); color:var(--c-text); font-size:12px; }
  .dshc-pill:hover { background:var(--c-active); }
  .dshc-pill select { height:100%; max-width:170px; padding:0 22px 0 10px; border:none; background:transparent; color:inherit; font:inherit; appearance:none; -webkit-appearance:none; cursor:pointer; outline:none; }
  .dshc-pill select option { background:var(--c-ctl-bg); color:var(--c-text); }
  .dshc-pill .dshc-icon { position:absolute; right:6px; pointer-events:none; color:var(--c-muted); }
  .dshc-pill.check { gap:6px; padding:0 10px; cursor:pointer; }
  .dshc-pill.check input { margin:0; accent-color:var(--c-brand); }
  .dshc-send { display:inline-flex; align-items:center; justify-content:center; flex:none; width:32px; height:32px; padding:0; border:none; border-radius:50%; background:var(--c-primary-bg); color:var(--c-primary-fg); cursor:pointer; transition:background .15s; }
  .dshc-send:hover:not(:disabled) { background:var(--c-primary-hover); }
  .dshc-send:disabled { opacity:.35; cursor:not-allowed; }
  .dshc-send .dshc-spin { width:14px; height:14px; border-color:color-mix(in srgb, var(--c-primary-fg) 30%, transparent); border-top-color:var(--c-primary-fg); }
  .dshc-hint { color:var(--c-muted); font-size:11px; white-space:nowrap; }

  /* ── Buttons inside the canvas ── */
  .dshc-root .dshc-btn { display:inline-flex; align-items:center; gap:4px; height:28px; padding:0 10px; border:none; border-radius:8px; background:var(--c-hover); color:var(--c-text); font-size:12px; white-space:nowrap; cursor:pointer; }
  .dshc-root .dshc-btn:hover:not(:disabled) { background:var(--c-active); }
  .dshc-root .dshc-btn:disabled { opacity:.4; cursor:not-allowed; }
  .dshc-root .dshc-btn.primary { background:var(--c-primary-bg); color:var(--c-primary-fg); font-weight:500; }
  .dshc-root .dshc-btn.primary:hover:not(:disabled) { background:var(--c-primary-hover); }
  .dshc-root .dshc-error { color:var(--c-danger); }

  /* ── Text, frame, script, legacy generator ── */
  .dshc-text { display:flex; flex-direction:column; }
  .dshc-text.colored { color:#262626; border-color:transparent; }
  .dshc-grip { flex:none; height:12px; border-radius:12px 12px 0 0; cursor:grab; }
  .dshc-grip:active { cursor:grabbing; }
  .dshc-text textarea { flex:1; min-height:0; width:100%; box-sizing:border-box; padding:0 14px 12px; border:none; background:transparent; color:inherit; font:inherit; line-height:1.6; resize:none; outline:none; }
  .dshc-text textarea::placeholder { color:var(--c-muted); }
  .dshc-frame { width:100%; height:100%; box-sizing:border-box; border:1px solid var(--dshc-frame, var(--c-group-border)); border-radius:16px; background:var(--c-group-bg); }
  .dshc-frame.is-selected { border-color:var(--c-node-sel); }
  .dshc-frame-label { position:absolute; bottom:calc(100% + 6px); left:0; max-width:calc(100% - 8px); padding:1px 4px; border:none; border-radius:6px; background:transparent; color:var(--c-text-2); font:inherit; font-size:13px; font-weight:500; outline:none; }
  .dshc-frame-label:focus { background:var(--c-hover); }
  .dshc-script { display:flex; flex-direction:column; overflow:hidden; }
  .dshc-script-head { display:flex; align-items:center; gap:6px; padding:8px 10px 8px 14px; border-bottom:1px solid var(--c-line); }
  .dshc-script-head .meta { flex:1; color:var(--c-muted); font-size:12px; white-space:nowrap; }
  .dshc-script-body { flex:1; min-height:0; overflow:auto; scrollbar-width:thin; }
  .dshc-script table { width:100%; border-collapse:collapse; table-layout:fixed; }
  .dshc-script th { position:sticky; top:0; z-index:1; padding:8px 6px; background:var(--c-node); color:var(--c-muted); font-size:12px; font-weight:500; text-align:left; border-bottom:1px solid var(--c-line); }
  .dshc-script th:nth-child(1) { width:30px; padding-left:14px; } .dshc-script th:nth-child(2) { width:58px; } .dshc-script th:nth-child(5) { width:96px; }
  .dshc-script td { padding:6px; border-bottom:1px solid var(--c-line); vertical-align:top; }
  .dshc-script tr:hover td { background:var(--c-soft); }
  .dshc-script td.num { padding-left:14px; padding-top:11px; color:var(--c-muted); font-size:12px; font-variant-numeric:tabular-nums; }
  .dshc-script td textarea, .dshc-script td input { width:100%; box-sizing:border-box; padding:4px 6px; border:1px solid transparent; border-radius:6px; background:transparent; color:var(--c-text); font:inherit; font-size:12px; line-height:1.5; resize:vertical; outline:none; }
  .dshc-script td textarea:focus, .dshc-script td input:focus { border-color:var(--c-node-sel); background:var(--c-input); }
  .dshc-script td.ops { display:flex; gap:2px; align-items:flex-start; padding-top:8px; }
  .dshc-script td.ops button { height:24px; padding:0 8px; border:none; border-radius:6px; background:var(--c-hover); color:var(--c-text); font-size:12px; white-space:nowrap; cursor:pointer; }
  .dshc-script td.ops button:hover:not(:disabled) { background:var(--c-active); }
  .dshc-script td.ops button:disabled { opacity:.4; cursor:not-allowed; }
  .dshc-script td.ops button.del { width:24px; padding:0; background:transparent; color:var(--c-muted); }
  .dshc-script-empty { padding:20px; color:var(--c-muted); font-size:12px; text-align:center; }
  .dshc-gen { display:flex; flex-direction:column; gap:10px; padding:12px; overflow:hidden; }
  .dshc-gen.is-running { border-color:var(--c-brand); animation:dshc-pulse 1.6s ease-in-out infinite; }
  @keyframes dshc-pulse { 0%,100% { box-shadow:0 0 0 0 transparent; } 50% { box-shadow:0 0 0 4px var(--c-brand-surface); } }
  .dshc-gen-head { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .dshc-seg { display:inline-flex; padding:2px; border-radius:8px; background:var(--c-hover); }
  .dshc-seg button { height:24px; padding:0 12px; border:none; border-radius:6px; background:transparent; color:var(--c-muted); font-size:12px; cursor:pointer; }
  .dshc-seg button.on { background:var(--c-active); color:var(--c-text); }
  .dshc-prompt { flex:1; min-height:60px; padding:8px 10px; border:1px solid transparent; border-radius:8px; background:var(--c-input); color:var(--c-text); font:inherit; line-height:1.6; resize:none; outline:none; }
  .dshc-prompt:focus { border-color:var(--c-node-sel); }
  .dshc-gen-foot { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .dshc-gen-status { flex:1; min-width:0; overflow:hidden; color:var(--c-muted); font-size:12px; white-space:nowrap; text-overflow:ellipsis; }
  .dshc-gen-status.dshc-error { color:var(--c-danger); }

  /* ── Overlays ── */
  .dshc-center { color:var(--c-muted); }
  .dshc-dropping::after { content:attr(data-drop); position:absolute; inset:10px; display:flex; align-items:center; justify-content:center; border:1.5px dashed var(--c-brand); border-radius:16px; background:var(--c-brand-surface); color:var(--c-brand-text); font-weight:500; pointer-events:none; z-index:10; }
  .dshc-modal-backdrop { position:absolute; inset:0; z-index:20; display:flex; align-items:center; justify-content:center; background:var(--c-scrim); }
  .dshc-modal { width:min(420px, calc(100% - 32px)); padding:18px; border-radius:16px; display:flex; flex-direction:column; gap:12px; box-shadow:var(--c-shadow-menu); }
  .dshc-modal h3 { margin:0; font-size:15px; font-weight:600; }
  .dshc-modal p { margin:0; color:var(--c-muted); font-size:12px; line-height:1.6; }
  .dshc-modal input { height:36px; padding:0 12px; border:1px solid transparent; border-radius:10px; background:var(--c-input); color:var(--c-text); font:inherit; outline:none; }
  .dshc-modal input:focus { border-color:var(--c-node-sel); }
  .dshc-modal .row { display:flex; justify-content:flex-end; gap:8px; }
  .dshc-modal .row .dshc-btn { height:32px; padding:0 14px; font-size:13px; }
  .dshc-modal .status { font-size:12px; color:var(--c-text-2); }

  /* ── Library drawer ── */
  .dshc-drawer { position:absolute; z-index:14; top:62px; right:12px; bottom:12px; display:flex; flex-direction:column; box-sizing:border-box; width:min(360px, calc(100cqw - 24px)); overflow:hidden; border-radius:16px; box-shadow:var(--c-shadow-menu); }
  .dshc-drawer > .dshc-lib-detail { display:flex; flex-direction:column; min-height:0; flex:1; }
  .dshc-lib-head { display:flex; align-items:center; gap:6px; padding:8px 8px 6px 12px; }
  .dshc-lib-head strong { font-size:14px; font-weight:600; }
  .dshc-lib-head .count { flex:1; color:var(--c-muted); font-size:12px; white-space:nowrap; }
  .dshc-lib-head .title { flex:1; min-width:0; height:28px; padding:0 6px; border:1px solid transparent; border-radius:8px; background:transparent; color:var(--c-text); font:inherit; font-size:14px; font-weight:600; outline:none; }
  .dshc-lib-head .title:focus, .dshc-lib-head .title:hover { border-color:var(--c-ctl-border); background:var(--c-input); }
  .dshc-lib-head .dshc-ibtn { width:28px; height:28px; }
  .dshc-lib-sub { display:flex; align-items:center; gap:8px; padding:0 12px 8px; color:var(--c-muted); font-size:11px; }
  .dshc-lib-sub code { padding:1px 5px; border-radius:4px; background:var(--c-soft); font-size:10px; }
  .dshc-lib-tabs { display:flex; gap:2px; padding:0 8px 8px; overflow-x:auto; scrollbar-width:none; }
  .dshc-lib-tabs button { flex:none; height:26px; padding:0 10px; border:none; border-radius:7px; background:transparent; color:var(--c-muted); font-size:12px; cursor:pointer; }
  .dshc-lib-tabs button:hover { background:var(--c-hover); color:var(--c-text); }
  .dshc-lib-tabs button.on { background:var(--c-active); color:var(--c-text); }
  .dshc-lib-cats { display:flex; flex-wrap:wrap; gap:4px; padding:0 12px 8px; }
  .dshc-lib-cats button { height:22px; padding:0 8px; border:1px solid var(--c-ctl-border); border-radius:11px; background:transparent; color:var(--c-muted); font-size:11px; cursor:pointer; }
  .dshc-lib-cats button:hover { color:var(--c-text); }
  .dshc-lib-cats button .n { margin-left:4px; opacity:.7; font-variant-numeric:tabular-nums; }
  .dshc-lib-cats button.empty:not(.on) { opacity:.5; }
  .dshc-lib-cats button.on { border-color:transparent; background:var(--c-brand-surface); color:var(--c-brand-text); }
  .dshc-lib-cat select { height:20px; padding:0 4px; border:1px solid var(--c-ctl-border); border-radius:6px; background:var(--c-input); color:var(--c-text); font:inherit; font-size:11px; outline:none; cursor:pointer; }
  .dshc-tag.cat { background:#000000a0; color:#fff; }
  .dshc-save-lib { display:inline-flex; align-items:center; gap:4px; }
  .dshc-lib-search { display:flex; align-items:center; gap:6px; margin:0 12px 8px; padding:0 4px 0 10px; height:32px; border-radius:9px; background:var(--c-input); color:var(--c-muted); }
  .dshc-lib-search input { flex:1; min-width:0; height:100%; border:none; background:transparent; color:var(--c-text); font:inherit; font-size:12px; outline:none; }
  .dshc-lib-search input::placeholder { color:var(--c-muted); }
  .dshc-lib-search .dshc-btn { height:24px; }
  .dshc-lib-scroll { flex:1; min-height:0; overflow-y:auto; scrollbar-width:thin; }
  .dshc-lib-list { display:grid; grid-template-columns:repeat(auto-fill, minmax(140px, 1fr)); align-content:start; gap:8px; padding:0 12px 8px; }
  .dshc-lib-card { position:relative; display:flex; flex-direction:column; min-width:0; padding:0; overflow:hidden; border:1px solid var(--c-node-border); border-radius:10px; background:var(--c-node); color:var(--c-text); text-align:left; cursor:grab; transition:border-color .15s; }
  .dshc-lib-card:hover { border-color:var(--c-node-sel); }
  .dshc-lib-card .thumb { display:block; width:100%; aspect-ratio:1; object-fit:cover; background:#0000001a; }
  .dshc-lib-card.kind-video .thumb, .dshc-lib-card.kind-link .thumb { aspect-ratio:16/10; }
  .dshc-lib-card .thumb.empty { display:flex; align-items:center; justify-content:center; color:var(--c-muted); }
  .dshc-lib-card .text { height:84px; padding:10px 10px 0; overflow:hidden; color:var(--c-text-2); font-size:12px; line-height:1.5; display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; word-break:break-word; }
  .dshc-lib-card .foot { display:flex; align-items:center; gap:5px; padding:7px 8px; color:var(--c-muted); font-size:11px; }
  .dshc-lib-card .foot .name { flex:1; min-width:0; overflow:hidden; color:var(--c-text-2); white-space:nowrap; text-overflow:ellipsis; }
  .dshc-lib-card .foot .ver { flex:none; font-variant-numeric:tabular-nums; }
  .dshc-lib-card .tags { position:absolute; top:6px; left:6px; display:flex; gap:3px; }
  .dshc-lib-card .sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); }
  .dshc-lib-empty { flex:1; padding:32px 20px; color:var(--c-muted); font-size:12px; line-height:1.6; text-align:center; }
  .dshc-lib-hint { padding:8px 12px 10px; border-top:.5px solid var(--c-ctl-border); color:var(--c-muted); font-size:11px; text-align:center; }
  .dshc-tag { display:inline-flex; align-items:center; height:16px; padding:0 5px; border-radius:4px; background:var(--c-soft); color:var(--c-muted); font-size:10px; line-height:16px; }
  .dshc-tag.on { background:var(--c-brand-surface); color:var(--c-brand-text); }
  .dshc-lib-composer { display:flex; flex-direction:column; gap:6px; margin:0 12px 10px; padding:8px; border:1px dashed var(--c-ctl-border); border-radius:10px; }
  .dshc-lib-composer textarea { width:100%; box-sizing:border-box; padding:4px; border:none; background:transparent; color:var(--c-text); font:inherit; font-size:12px; line-height:1.55; resize:vertical; outline:none; }
  .dshc-lib-composer .row { display:flex; gap:6px; }
  .dshc-lib-composer input { flex:1; min-width:0; height:28px; padding:0 8px; border:none; border-radius:7px; background:var(--c-input); color:var(--c-text); font:inherit; font-size:12px; outline:none; }
  .dshc-lib-version, .dshc-lib-run { display:flex; flex-direction:column; gap:6px; margin:0 12px 10px; padding:10px; border-radius:10px; background:var(--c-soft); }
  .dshc-lib-version header, .dshc-lib-run header, .dshc-lib-media header { display:flex; align-items:center; gap:5px; font-size:12px; }
  .dshc-lib-version header b, .dshc-lib-media header b { font-variant-numeric:tabular-nums; }
  .when { margin-left:auto; color:var(--c-muted); font-size:11px; white-space:nowrap; }
  .dshc-lib-version .note { color:var(--c-brand-text); font-size:12px; }
  .dshc-lib-version .text, .dshc-lib-run .text { color:var(--c-text-2); font-size:12px; line-height:1.55; white-space:pre-wrap; word-break:break-word; max-height:9.3em; overflow:auto; }
  .dshc-lib-version .meta, .dshc-lib-run .meta, .dshc-lib-media .meta { color:var(--c-muted); font-size:11px; }
  .dshc-lib-version .outputs { display:flex; flex-wrap:wrap; gap:4px; }
  .dshc-lib-version .out { width:52px; height:52px; padding:0; overflow:hidden; border:1px solid var(--c-node-border); border-radius:6px; background:none; cursor:pointer; }
  .dshc-lib-version .out .thumb { width:100%; height:100%; object-fit:cover; display:block; }
  .dshc-lib-version .out:hover { border-color:var(--c-node-sel); }
  .dshc-lib-version .cover { width:100%; max-height:160px; object-fit:cover; border-radius:8px; }
  .dshc-lib-version .url { overflow:hidden; color:var(--c-text-2); font-size:11px; white-space:nowrap; text-overflow:ellipsis; }
  .acts { display:flex; flex-wrap:wrap; gap:4px; }
  .dshc-root .acts .dshc-btn { height:24px; padding:0 8px; font-size:11px; }
  .dshc-root .acts .dshc-btn[aria-pressed="true"] { background:var(--c-brand-surface); color:var(--c-brand-text); }
  .dshc-lib-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:8px; padding:0 12px 10px; }
  .dshc-lib-media { display:flex; flex-direction:column; gap:6px; min-width:0; padding:6px; border-radius:10px; background:var(--c-soft); cursor:grab; }
  .dshc-lib-media .thumb { width:100%; aspect-ratio:1; object-fit:cover; border-radius:7px; background:#0000001a; }
  .dshc-lib-media .dshc-chip { align-self:flex-start; }
  .dshc-lib-run.failed { box-shadow:inset 2px 0 0 var(--c-danger); }
  .dshc-lib-run .chips { display:flex; flex-wrap:wrap; gap:4px; }
  .dshc-bind { display:inline-flex; align-items:center; gap:1px; }
  .dshc-bind .dshc-chip { background:var(--c-brand-surface); color:var(--c-brand-text); cursor:pointer; }
  .dshc-bind .dshc-chip .nm { max-width:110px; overflow:hidden; text-overflow:ellipsis; }
  .dshc-bind.edited .dshc-chip:first-child { background:#f4b7402e; color:#f4b740; }
  .dshc-bind .dshc-chip.x { padding:0 5px; background:transparent; color:var(--c-muted); }

  /* ── Link node ── */
  .dshc-link { display:flex; flex-direction:column; overflow:hidden; }
  .dshc-link img { flex:1; min-height:0; width:100%; object-fit:cover; border-radius:11px 11px 0 0; }
  .dshc-link .body { flex:none; display:flex; flex-direction:column; gap:3px; padding:9px 12px 10px; }
  .dshc-link .body b { overflow:hidden; font-size:13px; font-weight:600; white-space:nowrap; text-overflow:ellipsis; }
  .dshc-link .body p { margin:0; overflow:hidden; color:var(--c-muted); font-size:11px; line-height:1.45; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .dshc-link .body a { display:inline-flex; align-items:center; gap:4px; color:var(--c-brand-text); font-size:11px; text-decoration:none; }

  /* ── Narrow (the usual right-sidebar width): vertical controls, icon-only bars, panel within the board ── */
  @container dshc (max-width: 760px) {
    .dshc-controls { flex-direction:column; }
    .dshc-controls .dshc-sep { width:16px; height:0; margin:4px 0; border-left:none; border-top:.5px solid var(--c-ctl-border); }
    .dshc-zoom { min-width:32px; padding:0; font-size:11px; }
    .dshc-root .react-flow__minimap.dshc-minimap { margin-bottom:12px; margin-left:62px; }
    .dshc-nodebar .dshc-tbtn, .dshc-actions .dshc-tbtn { width:32px; padding:0; justify-content:center; position:relative; }
    .dshc-nodebar .lbl, .dshc-actions .lbl, .dshc-hint { display:none; }
    .dshc-actions .count { position:absolute; top:2px; right:0; }
    .dshc-dock .add .lbl { display:none; } .dshc-dock .add { width:32px; padding:0; }
    .dshc-drawer { bottom:62px; }
  }
`;
