import { createFileRoute } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionQr } from "@/components/karaoke/SessionQr";

export const Route = createFileRoute("/qr/$code")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "QR Code de votação — BatalhaOkê" },
      { name: "description", content: "Versão para impressão do QR Code de votação da sessão." },
      { property: "og:title", content: "QR Code de votação — BatalhaOkê" },
      { property: "og:description", content: "Imprima e deixe nas mesas para o público votar." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: PrintPage,
});

function PrintPage() {
  const { code } = Route.useParams();
  return (
    <main className="print-sheet mx-auto flex min-h-dvh w-full max-w-md flex-col items-center gap-6 px-5 py-8">
      <div className="no-print flex w-full justify-center">
        <Button size="lg" className="h-12" onClick={() => window.print()}><Printer className="size-5" /> Imprimir</Button>
      </div>
      <article className="print-card flex w-full flex-col items-center gap-5 rounded-2xl border-2 p-8 text-center">
        <p className="font-display text-4xl">🎤 BatalhaOkê</p>
        <p className="font-display text-5xl">Participe!</p>
        <SessionQr code={code} size={240} />
        <p className="font-display text-3xl">Escaneie para votar</p>
        <p className="text-lg">Vote pelo celular</p>
      </article>
    </main>
  );
}
