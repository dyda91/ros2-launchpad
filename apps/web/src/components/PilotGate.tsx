import { useState } from "react";

import { redeemInvite } from "../lib/api";

interface PilotGateProps {
  onRedeemed: () => Promise<void>;
}

export default function PilotGate({ onRedeemed }: PilotGateProps) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || code.trim() === "") {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await redeemInvite(code);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCode("");
      await onRedeemed();
    } catch {
      setError("não foi possível validar o convite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="landing">
      <div className="landing-card pilot-gate" data-testid="pilot-gate">
        <p className="eyebrow">Piloto privado</p>
        <h2>Entre com seu convite</h2>
        <p>
          O acesso é por convite. Não há cadastro, nome de usuário ou senha;
          o código abre uma sessão anônima temporária.
        </p>
        <form className="pilot-form" onSubmit={handleSubmit}>
          <label htmlFor="pilot-code">Código do convite</label>
          <input
            id="pilot-code"
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            data-testid="invite-code"
            placeholder="XXXX-XXXX-XXXX"
          />
          <button
            className="button button-primary"
            type="submit"
            disabled={busy || code.trim() === ""}
            data-testid="invite-submit"
          >
            {busy ? "Validando..." : "Entrar no laboratório"}
          </button>
        </form>
        {error ? (
          <p className="pilot-error" role="alert" data-testid="invite-error">
            {error}
          </p>
        ) : null}
        <p className="small">
          O convite é pessoal e temporário. Não compartilhe o código.
        </p>
      </div>
    </main>
  );
}
