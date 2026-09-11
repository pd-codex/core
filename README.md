# Core 0.2 — First Contact

Browser-first prototype: enter a running MC9S08QG8 microcontroller and intervene at the bit level. Three experiments: **Conduction**, **Intent**, and **Override**.

## Run and test

Requires Python 3 and a recent Node.js release. No npm dependencies need installing.

```bash
npm test
npm run serve
```

Open http://localhost:8000. The browser downloads Three.js 0.180.0 from jsDelivr, so this is not an offline build.

## GitHub Pages

In this repository select **Settings → Pages → Source: GitHub Actions**. Then run **Actions → Publish Core → Run workflow** if the initial run failed before Pages was enabled. Later pushes to `main` build, test, and publish automatically.

The workflow publishes only `dist/`, never the repository settings, tooling, or development files. The expected public project address is https://pd-codex.github.io/core/ after a successful deployment; it is not a claim that the site is already live.

This upload does not change repository visibility. A private organization repository needs an eligible paid organization plan for Pages. A published Pages site is normally public even when its source repository is private. On GitHub Free for organizations, Pages needs a public repository; changing visibility is an owner decision.

## Packaging and fidelity

The existing 0.2 renderer and emulator are preserved. `firmware/*.json` contains the original assembled byte listings and SHA-256 digests. `tools/build_site.py` restores the three original 8 KB ROM images into `dist/firmware/` and refuses to publish a mismatching image. This is deterministic packaging, not a new assembler or a different instruction set. The binaries are generated build outputs rather than tracked files.

The emulator implements a deliberately limited HCS08 subset. Unsupported instructions and memory accesses fault; this is not a complete QG8 emulator. Charge pulses and clamps are fictional interventions, distinct from normal CPU writes. Source `.ts` files are unchanged development mirrors of the directly executed `.js` modules; there is no TypeScript compilation step in this revision.

The source simulation checks cover boot and all three intended puzzle paths. Successful CI does not establish physical iPad or VR validation.
