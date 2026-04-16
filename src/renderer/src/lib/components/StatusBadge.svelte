<script lang="ts">
  import type { InstanceStatus } from '../types'

  let { status }: { status: InstanceStatus } = $props()

  const config = $derived({
    idle: { color: '#4ade80', label: 'Idle', pulse: false },
    thinking: { color: '#60a5fa', label: 'Thinking', pulse: true },
    waiting: { color: '#facc15', label: 'Waiting', pulse: true },
    error: { color: '#f87171', label: 'Error', pulse: false }
  }[status])
</script>

<span class="badge" class:pulse={config.pulse} style="--color: {config.color}">
  <span class="dot"></span>
  {config.label}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color);
    padding: 2px 8px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--color) 15%, transparent);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color);
  }

  .pulse .dot {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
</style>
