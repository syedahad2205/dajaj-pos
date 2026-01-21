'use client';

import { useState } from 'react';
import { addonsData } from '@/lib/menu';

const SOFT_BLACK = '#1a1a1a';
const SOFT_WHITE = '#fafafa';
const SOFT_GRAY = '#e8e8e8';
const BRAND_RED = '#d43f2f';

interface ShawarmaAddonsModalProps {
  itemName: string;
  variant: 'Roll' | 'Plate';
  variantPrice: number;
  onClose: () => void;
  onConfirm: (quantity: number, addons: string[]) => void;
}

export default function ShawarmaAddonsModal({
  itemName,
  variant,
  variantPrice,
  onClose,
  onConfirm
}: ShawarmaAddonsModalProps) {
  const [quantity, setQuantity] = useState(1);
  const [selectedAddons, setSelectedAddons] = useState<string[]>([]);

  const applicableAddons = addonsData.filter(addon => {
    return addon.price[variant] !== undefined || addon.price[''] !== undefined;
  });

  const toggleAddon = (addonId: string) => {
    setSelectedAddons(prev => 
      prev.includes(addonId) 
        ? prev.filter(id => id !== addonId)
        : [...prev, addonId]
    );
  };

  const getAddonPrice = (addonId: string): number => {
    const addon = addonsData.find(a => a.id === addonId);
    if (!addon) return 0;
    return addon.price[variant] || addon.price[''] || 0;
  };

  const addonTotal = selectedAddons.reduce((sum, id) => sum + getAddonPrice(id), 0);
  const total = (variantPrice + addonTotal) * quantity;

  const handleConfirm = () => {
    onConfirm(quantity, selectedAddons);
    onClose();
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
      <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto border" style={{ borderColor: SOFT_GRAY }}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold" style={{ color: SOFT_BLACK }}>{itemName}</h2>
          <button
            onClick={onClose}
            className="transition-colors text-2xl"
            style={{ color: SOFT_BLACK + '99' }}
            onMouseEnter={(e) => e.currentTarget.style.color = SOFT_BLACK}
            onMouseLeave={(e) => e.currentTarget.style.color = SOFT_BLACK + '99'}
          >
            ×
          </button>
        </div>

        <div className="mb-4">
          <div className="text-sm font-medium mb-2" style={{ color: SOFT_BLACK + '99' }}>
            Variant: {variant} - ₹{variantPrice}
          </div>
        </div>

        {applicableAddons.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2" style={{ color: SOFT_BLACK }}>
              Add-ons
            </label>
            <div className="space-y-2">
              {applicableAddons.map(addon => {
                const price = getAddonPrice(addon.id);
                const isSelected = selectedAddons.includes(addon.id);
                const canSelect = addon.price[variant] !== undefined || addon.price[''] !== undefined;

                if (!canSelect) return null;

                return (
                  <label 
                    key={addon.id} 
                    className="flex items-center justify-between cursor-pointer p-3 rounded border transition-colors"
                    style={{ 
                      borderColor: isSelected ? BRAND_RED : SOFT_GRAY,
                      backgroundColor: isSelected ? BRAND_RED + '10' : 'transparent'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = SOFT_BLACK + '40';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = SOFT_GRAY;
                      }
                    }}
                  >
                    <div className="flex items-center space-x-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleAddon(addon.id)}
                        className="w-5 h-5 rounded"
                        style={{ 
                          accentColor: BRAND_RED,
                          borderColor: SOFT_GRAY
                        }}
                      />
                      <span className="text-sm font-medium" style={{ color: SOFT_BLACK }}>{addon.name}</span>
                    </div>
                    <span className="text-sm" style={{ color: SOFT_BLACK + '99' }}>₹{price}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2" style={{ color: SOFT_BLACK }}>
            Quantity
          </label>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setQuantity(Math.max(1, quantity - 1))}
              className="rounded-lg font-bold text-lg transition-colors"
              style={{ 
                backgroundColor: SOFT_BLACK, 
                color: SOFT_WHITE,
                minHeight: '48px', 
                minWidth: '48px' 
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
            >
              –
            </button>
            <span className="text-lg font-medium w-12 text-center" style={{ color: SOFT_BLACK }}>{quantity}</span>
            <button
              onClick={() => setQuantity(quantity + 1)}
              className="rounded-lg font-bold text-lg transition-colors"
              style={{ 
                backgroundColor: SOFT_BLACK, 
                color: SOFT_WHITE,
                minHeight: '48px', 
                minWidth: '48px' 
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
            >
              +
            </button>
          </div>
        </div>

        <div className="mb-4 p-4 rounded-lg border" style={{ backgroundColor: SOFT_WHITE, borderColor: SOFT_GRAY }}>
          <div className="flex justify-between text-lg font-semibold" style={{ color: SOFT_BLACK }}>
            <span>Total:</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors"
            style={{ 
              border: `2px solid ${SOFT_GRAY}`,
              color: SOFT_BLACK,
              minHeight: '48px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = SOFT_WHITE}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="flex-1 px-4 py-3 rounded-lg font-medium transition-colors"
            style={{ 
              backgroundColor: SOFT_BLACK, 
              color: SOFT_WHITE,
              minHeight: '48px'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#2a2a2a'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = SOFT_BLACK}
          >
            Add to Cart
          </button>
        </div>
      </div>
    </div>
  );
}
