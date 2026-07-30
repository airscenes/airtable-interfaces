// --- Gallery Card ---

function getInitials(name) {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].charAt(0).toUpperCase();
  return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
}

export function SpectacleCard({ name, subtitle, imageUrl, placeholderColor, onClick }) {
  const initials = getInitials(name);
  const bgColor = placeholderColor || "#666666";

  return (
    <div
      onClick={onClick}
      className="bg-white dark:bg-gray-gray700 rounded-lg shadow-sm overflow-hidden cursor-pointer
                       hover:shadow-md transition-shadow duration-200 border border-gray-gray100 dark:border-gray-gray600"
    >
      <div
        className="w-full"
        style={{ height: 160, overflow: "hidden" }}
      >
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <div
            className="flex items-center justify-center h-full"
            style={{ backgroundColor: bgColor }}
          >
            <span style={{ fontSize: 40, fontWeight: 700, color: "rgba(255,255,255,0.85)", letterSpacing: 2 }}>
              {initials}
            </span>
          </div>
        )}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold text-gray-gray700 dark:text-gray-gray200 truncate">
          {name}
        </p>
        {subtitle && (
          <p className="text-xs text-gray-gray400 dark:text-gray-gray500 truncate mt-0.5">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
}
