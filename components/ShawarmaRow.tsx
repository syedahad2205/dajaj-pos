'use client';

import { PlusCircle } from 'lucide-react';
import { type MenuItem } from '@/lib/menu';

const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';
const BRAND_RED = '#d43f2f';

interface ShawarmaRowProps {
  item: MenuItem;
  rollQuantity: number;
  plateQuantity: number;
  rollPrice: number;
  platePrice: number;
  onAddNormal: (variant: 'Roll' | 'Plate') => void;
  onDecrement: (variant: 'Roll' | 'Plate') => void;
  onOpenAddonsDialog: (variant: 'Roll' | 'Plate') => void;
}

export default function ShawarmaRow({
  item,
  rollQuantity,
  plateQuantity,
  rollPrice,
  platePrice,
  onAddNormal,
  onDecrement,
  onOpenAddonsDialog
}: ShawarmaRowProps) {
  const renderVariantColumn = (
    variant: 'Roll' | 'Plate',
    quantity: number,
    price: number
  ) => {
    const hasQuantity = quantity > 0;
    
    return (
      <div 
        className="flex flex-col gap-2 p-3 border rounded-lg"
        style={{ 
          borderColor: SOFT_GRAY,
          width: '100%',
          minHeight: hasQuantity ? 'auto' : '120px',
          boxSizing: 'border-box'
        }}
      >
        {/* Variant label - always visible */}
        <div className="text-xs font-medium uppercase tracking-wide" style={{ color: SOFT_BLACK + '80', marginBottom: '4px' }}>
          {variant}
        </div>
        
        {/* Top row: ADD button and ADD-ONS button */}
        <div className="flex gap-2" style={{ width: '100%' }}>
          {/* ADD button */}
          <button
            onClick={() => onAddNormal(variant)}
            className="flex-1 flex items-center justify-center rounded-lg font-semibold transition-all"
            style={{
              backgroundColor: SOFT_BLACK,
              color: SOFT_WHITE,
              minHeight: '48px',
              border: `1px solid ${SOFT_BLACK}`,
              flex: '1 1 0%',
              minWidth: 0
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
          >
            <span className="text-sm uppercase">ADD</span>
          </button>
          
          {/* ADD-ONS button */}
          <button
            onClick={() => onOpenAddonsDialog(variant)}
            className="flex items-center justify-center rounded-lg transition-colors flex-shrink-0"
            style={{
              backgroundColor: SOFT_WHITE,
              border: `1px solid ${SOFT_GRAY}`,
              minHeight: '48px',
              width: '48px',
              color: SOFT_BLACK
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = BRAND_RED;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = SOFT_GRAY;
            }}
            title="Add with Add-ons"
          >
            <PlusCircle size={20} />
          </button>
        </div>
        
        {/* Quantity display */}
        {hasQuantity && (
          <div className="flex items-center justify-center" style={{ width: '100%' }}>
            <div 
              className="flex items-center rounded-lg border bg-white overflow-hidden" 
              style={{ 
                borderColor: SOFT_GRAY, 
                width: '100%',
                minHeight: '48px'
              }}
            >
              {/* Left 40% - Decrement */}
              <button
                onClick={() => onDecrement(variant)}
                className="flex-[2] h-full flex items-center justify-center transition-colors font-bold text-xl"
                style={{
                  minHeight: '48px',
                  color: SOFT_BLACK,
                  flex: '2 1 0%',
                  minWidth: 0
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                –
              </button>
              {/* Middle 20% - Quantity */}
              <div 
                className="flex-[1] h-full flex items-center justify-center font-bold text-lg" 
                style={{ 
                  color: SOFT_BLACK,
                  flex: '1 1 0%',
                  minWidth: 0
                }}
              >
                {quantity}
              </div>
              {/* Right 40% - Increment */}
              <button
                onClick={() => onAddNormal(variant)}
                className="flex-[2] h-full flex items-center justify-center transition-colors font-bold text-xl"
                style={{
                  minHeight: '48px',
                  color: SOFT_BLACK,
                  flex: '2 1 0%',
                  minWidth: 0
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f5f5f5'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                +
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-4">
      <h4 className="font-semibold mb-3" style={{ color: SOFT_BLACK }}>{item.name}</h4>
      <div className="grid grid-cols-2 gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        {/* ROLL column (50%) */}
        {rollPrice > 0 && (
          <div style={{ width: '100%', minWidth: 0 }}>
            {renderVariantColumn('Roll', rollQuantity, rollPrice)}
          </div>
        )}
        
        {/* PLATE column (50%) */}
        {platePrice > 0 && (
          <div style={{ width: '100%', minWidth: 0 }}>
            {renderVariantColumn('Plate', plateQuantity, platePrice)}
          </div>
        )}
      </div>
    </div>
  );
}
