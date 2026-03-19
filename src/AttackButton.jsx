export default function AttackButton({ gauge, onAttack }) {
  const isAvailable = gauge >= 20;
  
  let stateClass = "attack-btn-disabled";
  let label = "CHARGE";

  if (gauge >= 100) {
    stateClass = "attack-btn-shield";
    label = "SHIELD";
  } else if (gauge >= 60) {
    stateClass = "attack-btn-jam";
    label = "FAKE JAM";
  } else if (gauge >= 20) {
    stateClass = "attack-btn-light";
    label = "ATTACK";
  }

  const handlePointerDown = (e) => {
    e.preventDefault(); // prevents input from losing focus
    if (isAvailable && onAttack) {
      onAttack();
    }
  };

  return (
    <div className="attack-button-container">
      <button 
        className={`attack-btn ${stateClass}`} 
        onPointerDown={handlePointerDown}
        disabled={!isAvailable}
      >
        <div className="attack-label">{label}</div>
        <div className="attack-gauge-val">{Math.floor(gauge)}%</div>
      </button>
    </div>
  );
}
