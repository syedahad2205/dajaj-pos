"use client";

import { useEffect, useRef, useState } from "react";
import { Autocomplete, CircleF, GoogleMap, MarkerF, useLoadScript } from "@react-google-maps/api";

const defaultCenter = { lat: 12.8698, lng: 74.8436 };
const mapLibraries: ("places")[] = ["places"];

function parseAddressComponents(place: google.maps.GeocoderResult | google.maps.places.PlaceResult) {
  const components = place.address_components ?? [];
  const find = (type: string) => components.find((component) => component.types.includes(type))?.long_name ?? "";

  const streetNumber = find("street_number");
  const route = find("route");
  const sublocality = find("sublocality") || find("sublocality_level_1");
  const locality = find("locality") || find("administrative_area_level_2");
  const postalCode = find("postal_code");
  const landmark = find("premise") || find("point_of_interest");

  return {
    addressLine1: [streetNumber, route].filter(Boolean).join(" ") || place.formatted_address || "",
    addressLine2: [sublocality, locality].filter(Boolean).join(", "),
    pincode: postalCode,
    landmark,
  };
}

export default function MapPicker({
  value,
  onChange,
  onAddressResolved,
  circles = [],
  autoLocateOnMount = false,
}: {
  value: { lat: number; lng: number } | null;
  onChange: (value: { lat: number; lng: number }) => void;
  onAddressResolved?: (details: { addressLine1?: string; addressLine2?: string; pincode?: string; landmark?: string }) => void;
  circles?: Array<{ radiusKm: number; color?: string }>;
  autoLocateOnMount?: boolean;
}) {
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || "",
    libraries: mapLibraries,
  });
  const [position, setPosition] = useState(value ?? defaultCenter);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const hasAutoLocatedRef = useRef(false);

  useEffect(() => {
    if (value) {
      setPosition(value);
    }
  }, [value]);

  useEffect(() => {
    if (!isLoaded || !autoLocateOnMount || value || hasAutoLocatedRef.current || typeof navigator === "undefined") {
      return;
    }

    hasAutoLocatedRef.current = true;

    navigator.geolocation.getCurrentPosition(
      (geoPosition) => {
        void applyPosition({
          lat: geoPosition.coords.latitude,
          lng: geoPosition.coords.longitude,
        });
      },
      () => {
        hasAutoLocatedRef.current = false;
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
      },
    );
  }, [autoLocateOnMount, isLoaded, value]);

  const applyPosition = async (nextPosition: { lat: number; lng: number }) => {
    setPosition(nextPosition);
    onChange(nextPosition);

    const geocoder = new google.maps.Geocoder();
    const response = await geocoder.geocode({ location: nextPosition });
    const firstResult = response.results?.[0];
    if (firstResult) {
      onAddressResolved?.(parseAddressComponents(firstResult));
    }
  };

  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY) {
    return (
      <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm text-amber-700">
        Add `NEXT_PUBLIC_GOOGLE_MAPS_KEY` to use the map picker.
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-4 text-sm text-rose-700">
        Failed to load Google Maps.
      </div>
    );
  }

  if (!isLoaded) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
        Loading map...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Autocomplete
          onLoad={(instance) => {
            autocompleteRef.current = instance;
          }}
          onPlaceChanged={() => {
            const place = autocompleteRef.current?.getPlace();
            const location = place?.geometry?.location;
            if (!location) {
              return;
            }

            const nextPosition = { lat: location.lat(), lng: location.lng() };
            void applyPosition(nextPosition);
            onAddressResolved?.(parseAddressComponents(place));
          }}
        >
          <input
            type="text"
            placeholder="Search your location"
            className="w-full rounded-2xl border border-slate-300 px-4 py-3"
          />
        </Autocomplete>
        <button
          type="button"
          onClick={() => {
            navigator.geolocation.getCurrentPosition((geoPosition) => {
              void applyPosition({
                lat: geoPosition.coords.latitude,
                lng: geoPosition.coords.longitude,
              });
            });
          }}
          className="rounded-2xl border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-700"
        >
          Use my current location
        </button>
      </div>

      <GoogleMap
        zoom={16}
        center={position}
        mapContainerStyle={{ width: "100%", height: "300px" }}
        options={{ streetViewControl: false, mapTypeControl: false, fullscreenControl: false }}
        onClick={(event) => {
          const lat = event.latLng?.lat();
          const lng = event.latLng?.lng();
          if (typeof lat === "number" && typeof lng === "number") {
            void applyPosition({ lat, lng });
          }
        }}
      >
        <MarkerF
          position={position}
          draggable
          onDragEnd={(event) => {
            const lat = event.latLng?.lat();
            const lng = event.latLng?.lng();
            if (typeof lat === "number" && typeof lng === "number") {
              void applyPosition({ lat, lng });
            }
          }}
        />
        {circles.map((circle, index) => (
          <CircleF
            key={`${circle.radiusKm}-${index}`}
            center={position}
            radius={circle.radiusKm * 1000}
            options={{
              fillColor: circle.color ?? "#f97316",
              fillOpacity: 0.08,
              strokeColor: circle.color ?? "#f97316",
              strokeOpacity: 0.65,
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>
    </div>
  );
}
