export default function HomePage() {
  return (
    <main>
      <h1>ADA Auditor</h1>
      <p>Evidence-first accessibility risk auditor control plane.</p>
      <ul>
        <li><code>GET /api/health</code> — liveness</li>
        <li><code>GET /api/ready</code> — readiness</li>
        <li><code>POST /api/audit/run</code> — run audit (requires <code>AUDITOR_RUN_TOKEN</code>)</li>
      </ul>
    </main>
  );
}
