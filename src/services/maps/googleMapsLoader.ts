import { setOptions, importLibrary } from '@googlemaps/js-api-loader';

let configured = false;

export async function loadGoogleMaps() {
  if (!configured) {
    setOptions({
      key: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
      v: "weekly"
    });
    configured = true;
  }

  const mapsLibrary = await importLibrary("maps");
  // const markerLibrary = await importLibrary("marker"); // We're using standard Marker, so we might not need this right now, but if we do, we can load it here.

  return {
    Map: mapsLibrary.Map as typeof google.maps.Map,
  };
}
