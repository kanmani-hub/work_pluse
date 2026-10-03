/**
 * Location Autocomplete Service
 * 
 * Uses Google Places API (New) with AutocompleteSuggestion and fetchFields
 */

declare global {
  interface Window {
    google: any;
  }
}

export interface LocationSuggestion {
  placeId: string;
  displayName: string;
  primaryText: string;
  secondaryText: string;
  latitude?: number;
  longitude?: number;
  _placePrediction?: any;
}

export interface PlaceDetails {
  latitude: number;
  longitude: number;
  formattedAddress: string;
}

export interface LocationProvider {
  search(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]>;
  getDetails(placeId: string, suggestion?: LocationSuggestion): Promise<PlaceDetails>;
}

let googleMapsPromise: Promise<void> | null = null;
let sessionToken: any = null;
let currentSearchId = 0;

function loadGoogleMapsCore(): Promise<void> {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (googleMapsPromise) return googleMapsPromise;
  
  googleMapsPromise = new Promise((resolve, reject) => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      reject(new Error("Location search is not configured correctly."));
      return;
    }
    
    const existing = document.getElementById('google-maps-script');
    if (existing) {
      resolve();
      return;
    }
    
    // Inject the modern Google Maps inline bootstrap loader
    const script = document.createElement('script');
    script.id = 'google-maps-script';
    // Use the dynamic loading script approach required for importLibrary
    script.innerHTML = `
      (g=>{var h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",m=document,b=window;b=b[c]||(b[c]={});var d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,u=()=>h||(h=new Promise(async(f,n)=>{await (a=m.createElement("script"));e.set("libraries",[...r]+"");for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);a.src=\`https://maps.\${c}apis.com/maps/api/js?\`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));a.nonce=m.querySelector("script[nonce]")?.nonce||"";m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})({
        key: "${apiKey}",
        v: "weekly",
      });
    `;
    document.head.appendChild(script);
    resolve();
  });
  
  return googleMapsPromise;
}

const googlePlacesProvider: LocationProvider = {
  async search(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
    if (!query || query.trim().length < 3) return [];
    
    await loadGoogleMapsCore();
    
    const searchId = ++currentSearchId;
    
    try {
      const { AutocompleteSuggestion, AutocompleteSessionToken } = await window.google.maps.importLibrary("places");
      
      if (!sessionToken) {
        sessionToken = new AutocompleteSessionToken();
      }
      
      const request = {
        input: query,
        sessionToken: sessionToken
      };
      
      const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions(request);
      
      if (!suggestions || suggestions.length === 0) {
        return [];
      }

      return suggestions.map((s: any) => {
        const fullText = s.placePrediction.text.text;
        const commaIndex = fullText.indexOf(',');
        let primary = fullText;
        let secondary = '';
        if (commaIndex > -1) {
          primary = fullText.substring(0, commaIndex).trim();
          secondary = fullText.substring(commaIndex + 1).trim();
        }
        return {
          placeId: s.placePrediction.placeId,
          displayName: fullText,
          primaryText: primary,
          secondaryText: secondary,
          _placePrediction: s.placePrediction
        };
      });

    } catch (error: any) {
      if (error.name === 'AbortError' || searchId !== currentSearchId) {
        throw new DOMException('Aborted', 'AbortError');
      }
      throw new Error(`Google Places API error: ${error.message}`);
    }
  },

  async getDetails(placeId: string, suggestion?: LocationSuggestion): Promise<PlaceDetails> {
    await loadGoogleMapsCore();
    
    try {
      const { AutocompleteSessionToken, Place } = await window.google.maps.importLibrary("places");
      
      let place;
      if (suggestion && suggestion._placePrediction) {
        place = suggestion._placePrediction.toPlace();
      } else {
        place = new Place({ id: placeId });
      }

      await place.fetchFields({
        fields: ["displayName", "formattedAddress", "location"]
      });

      // Refresh token for the next session
      sessionToken = new AutocompleteSessionToken();

      if (!place.location) {
        throw new Error("Place has no location coordinates.");
      }

      return {
        latitude: place.location.lat(),
        longitude: place.location.lng(),
        formattedAddress: place.formattedAddress || place.displayName || ''
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch place details: ${error.message}`);
    }
  }
};

const nominatimProvider: LocationProvider = {
  async search(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
    if (!query || query.trim().length < 3) return [];
    
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`, {
        signal,
        headers: {
          'Accept-Language': 'en'
        }
      });
      if (!response.ok) throw new Error('Nominatim search failed');
      const data = await response.json();
      
      return data.map((item: any) => {
        const nameParts = item.display_name.split(', ');
        const primary = nameParts[0];
        const secondary = nameParts.slice(1).join(', ');
        
        return {
          placeId: item.place_id.toString(),
          displayName: item.display_name,
          primaryText: primary,
          secondaryText: secondary,
          latitude: parseFloat(item.lat),
          longitude: parseFloat(item.lon),
        };
      });
    } catch (error) {
      throw error;
    }
  },

  async getDetails(placeId: string, suggestion?: LocationSuggestion): Promise<PlaceDetails> {
    if (suggestion && suggestion.latitude !== undefined && suggestion.longitude !== undefined) {
      return {
        latitude: suggestion.latitude,
        longitude: suggestion.longitude,
        formattedAddress: suggestion.displayName
      };
    }
    throw new Error('Details not available for this location.');
  }
};

export const locationAutocomplete: LocationProvider = {
  async search(query: string, signal?: AbortSignal): Promise<LocationSuggestion[]> {
    try {
      return await googlePlacesProvider.search(query, signal);
    } catch (error: any) {
      if (error.name === 'AbortError' || error.message === 'Aborted') {
        throw error;
      }
      console.warn('Google Places API failed, falling back to Nominatim OpenStreetMap...', error);
      return await nominatimProvider.search(query, signal);
    }
  },
  async getDetails(placeId: string, suggestion?: LocationSuggestion): Promise<PlaceDetails> {
    if (suggestion && suggestion.latitude !== undefined && suggestion.longitude !== undefined) {
      return nominatimProvider.getDetails(placeId, suggestion);
    }
    try {
      return await googlePlacesProvider.getDetails(placeId, suggestion);
    } catch (error) {
      console.warn('Google Places API getDetails failed...', error);
      throw error;
    }
  }
};
