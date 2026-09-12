// An empty state must say WHY it is empty. "Aucune donnée" is the one message
// that never helps: the interesting cases are a period nobody worked, a table
// that is not configured, and an automation that has not run yet — and they call
// for three different actions.
export function EmptyState({title, detail, action}) {
    return (
        <div className="rounded border border-dashed border-gray-gray300 bg-white px-4 py-8 text-center dark:border-gray-gray600 dark:bg-gray-gray700">
            <p className="font-display text-sm font-semibold text-gray-gray700 dark:text-gray-gray200">
                {title}
            </p>
            {detail && (
                <p className="mx-auto mt-1 max-w-md text-xs text-gray-gray500 dark:text-gray-gray400">
                    {detail}
                </p>
            )}
            {action && <div className="mt-3">{action}</div>}
        </div>
    );
}

export function LinkButton({onClick, children}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="text-xs font-medium text-blue-blue hover:underline dark:text-blue-blueLight1"
        >
            {children}
        </button>
    );
}
