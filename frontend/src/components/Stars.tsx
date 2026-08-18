// Muestra u obtiene una puntuación de 1 a 5 estrellas.
export function Stars({
  valor,
  onChange,
  size = 18,
}: {
  valor: number;
  onChange?: (v: number) => void;
  size?: number;
}) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          onClick={onChange ? () => onChange(n) : undefined}
          style={{
            cursor: onChange ? "pointer" : "default",
            color: n <= Math.round(valor) ? "#f5b942" : "#3a3f4a",
            fontSize: size,
            lineHeight: 1,
          }}
          role={onChange ? "button" : undefined}
          aria-label={`${n} estrellas`}
        >
          ★
        </span>
      ))}
    </span>
  );
}
