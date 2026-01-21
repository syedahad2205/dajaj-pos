'use client';

const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';

interface GrillButtonWithStepperProps {
  variant: string;
  price: number;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
}

export default function GrillButtonWithStepper({
  variant,
  price,
  quantity,
  onIncrement,
  onDecrement
}: GrillButtonWithStepperProps) {
  const handleMainClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onIncrement();
  };

  const handleDecrementClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDecrement();
  };

  const handleIncrementClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onIncrement();
  };

  return (
    <>
      {quantity === 0 ? (
        <button
          onClick={handleMainClick}
          className="w-full flex items-center justify-center rounded-lg font-semibold transition-all"
          style={{ 
            backgroundColor: SOFT_BLACK, 
            color: SOFT_WHITE,
            minHeight: '56px',
            border: `1px solid ${SOFT_BLACK}`
          }}
          onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
          onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
        >
          <span className="text-base">{variant}</span>
        </button>
      ) : (
        <div className="w-full flex items-center rounded-lg border bg-white overflow-hidden" style={{ borderColor: SOFT_GRAY }}>
          {/* Left 40% - Decrement */}
          <button
            onClick={handleDecrementClick}
            className="flex-[2] h-full flex items-center justify-center transition-colors font-bold text-xl"
            style={{ 
              minHeight: '56px',
              color: SOFT_BLACK
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            –
          </button>
          {/* Middle 20% - Quantity */}
          <div className="flex-[1] h-full flex flex-col items-center justify-center font-bold text-lg" style={{ color: SOFT_BLACK }}>
            <span>{quantity}</span>
            <span className="text-xs opacity-70">{variant}</span>
          </div>
          {/* Right 40% - Increment */}
          <button
            onClick={handleIncrementClick}
            className="flex-[2] h-full flex items-center justify-center transition-colors font-bold text-xl"
            style={{ 
              minHeight: '56px',
              color: SOFT_BLACK
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            +
          </button>
        </div>
      )}
    </>
  );
}
