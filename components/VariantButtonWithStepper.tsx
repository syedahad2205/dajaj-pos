'use client';

import { Flame, PlusCircle, Plus } from 'lucide-react';

interface VariantButtonWithStepperProps {
  variant: string;
  price: number;
  quantity: number;
  onIncrement: () => void;
  onDecrement: () => void;
  showAddons?: boolean;
  onAddonClick?: (addonId: string) => void;
  availableAddons?: Array<{ id: string; name: string; price: number }>;
}

// Brand colors from SVG
const BRAND_RED = '#d43f2f';
const BRAND_YELLOW = '#f2b141';
const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';

const getAddonIcon = (addonId: string) => {
  switch (addonId) {
    case 'extra-spicy':
      return <Flame size={18} />;
    case 'cheese':
      return <PlusCircle size={18} />;
    case 'fries':
      return <Plus size={18} />;
    default:
      return <Plus size={18} />;
  }
};

export default function VariantButtonWithStepper({
  variant,
  price,
  quantity,
  onIncrement,
  onDecrement,
  showAddons = false,
  onAddonClick,
  availableAddons = []
}: VariantButtonWithStepperProps) {
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
    <div className="flex gap-2 h-14">
      {/* Main button (80% width) - PRIMARY */}
      {quantity === 0 ? (
        <button
          onClick={handleMainClick}
          className="flex-[4] flex items-center justify-center rounded-lg font-semibold transition-all bg-[#1a1a1a] text-white hover:bg-[#2a2a2a] border border-[#2a2a2a]"
          style={{ minHeight: '56px' }}
        >
          <span className="text-base uppercase tracking-wide">{variant}</span>
        </button>
      ) : (
        <div className="flex-[4] flex items-center rounded-lg border border-[#d0d0d0] bg-white overflow-hidden">
          {/* Left 40% - Decrement */}
          <button
            onClick={handleDecrementClick}
            className="flex-[2] h-full flex items-center justify-center hover:bg-[#f5f5f5] transition-colors text-[#1a1a1a] font-bold text-xl"
            style={{ minHeight: '56px' }}
          >
            –
          </button>
          {/* Middle 20% - Quantity */}
          <div className="flex-[1] h-full flex items-center justify-center text-[#1a1a1a] font-bold text-lg">
            {quantity}
          </div>
          {/* Right 40% - Increment */}
          <button
            onClick={handleIncrementClick}
            className="flex-[2] h-full flex items-center justify-center hover:bg-[#f5f5f5] transition-colors text-[#1a1a1a] font-bold text-xl"
            style={{ minHeight: '56px' }}
          >
            +
          </button>
        </div>
      )}
      
      {/* Add-ons buttons (20% width each) - SECONDARY */}
      {showAddons && availableAddons.length > 0 && (
        <div className="flex gap-1 flex-1">
          {availableAddons.map((addon) => (
            <button
              key={addon.id}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onAddonClick?.(addon.id);
              }}
              className="flex-1 bg-white border border-[#d0d0d0] hover:border-[#d43f2f] rounded-lg flex items-center justify-center text-[#1a1a1a] transition-colors"
              style={{ minHeight: '56px', minWidth: '48px' }}
              title={addon.name}
            >
              {getAddonIcon(addon.id)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
