# Runtime Safety States

MetaHuman OS supports two deployment-level restrictions. Set either variable before starting the service; the UI reports the active state.

- `HIGH_SECURITY=true` permits Emulation mode only.
- `WETWARE_DECEASED=true` disables Dual mode while leaving Agent, Emulation, and Environment modes available.

`HIGH_SECURITY` takes precedence when both are set. These states restrict cognitive-mode selection; they are not emergency-response or data-erasure systems.
