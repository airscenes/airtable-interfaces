import {useState} from 'react';

// Yellow banner listing what is not configured and what that costs. Collapsed
// to a one-line summary by default so a working extension is not buried under
// warnings, but never hidden entirely: a silent missing field is exactly the
// failure this component exists to prevent.
export function Diagnostics({items}) {
    const [open, setOpen] = useState(false);
    if (!items.length) return null;

    return (
        <div className="rounded border border-yellow-yellow bg-yellow-yellowLight2 px-3 py-2 text-xs text-gray-gray900">
            <button
                type="button"
                onClick={() => setOpen(!open)}
                className="flex w-full items-center gap-2 text-left font-medium"
            >
                <span className="text-sm leading-none">{open ? '▾' : '▸'}</span>
                <span>
                    {items.length} élément{items.length > 1 ? 's' : ''} de configuration manquant
                    {items.length > 1 ? 's' : ''} — certaines colonnes et alertes sont désactivées.
                </span>
            </button>

            {open && (
                <ul className="ml-6 mt-2 list-disc space-y-1">
                    {items.map((it, i) => (
                        <li key={i}>
                            <span className="font-medium">{it.title}</span> — {it.effect}
                        </li>
                    ))}
                </ul>
            )}

            {open && (
                <p className="ml-6 mt-2 text-gray-gray700">
                    Rappel : un champ absent de cette liste peut simplement ne pas être coché
                    <span className="font-medium"> Visible </span>
                    dans le panneau Données de l’extension — il est alors invisible pour le SDK,
                    sans erreur.
                </p>
            )}
        </div>
    );
}
