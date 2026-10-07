import React, { useState, useEffect } from 'react';
import { qaTimeService } from '../services/qa/qaTimeService';
import { locationService } from '../services/location/locationService';

export const QaControlPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [multiplier, setMultiplier] = useState(qaTimeService.getMultiplier());
  const [currentTime, setCurrentTime] = useState(qaTimeService.getDate().toLocaleTimeString());

  useEffect(() => {
    if (!qaTimeService.isEnabled) return;
    const timer = setInterval(() => {
      setCurrentTime(qaTimeService.getDate().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!qaTimeService.isEnabled) return null;

  const handleMultiplierChange = (m: number) => {
    qaTimeService.setMultiplier(m);
    setMultiplier(m);
  };

  const handleAdvance = (mins: number) => {
    qaTimeService.advanceTime(mins);
  };

  const setGps = (status: 'INSIDE' | 'OUTSIDE') => {
    if (status === 'INSIDE') {
      locationService.setQaMockLocation(13.0827, 80.2707);
    } else {
      locationService.setQaMockLocation(13.0900, 80.2900); // Outside
    }
    // Trigger location check immediately
    locationService.verifyCurrentLocation('LOCATION_CHECK');
  };

  return (
    <div className={`fixed bottom-4 right-4 z-50 bg-gray-900 text-white rounded-lg shadow-xl p-4 transition-all ${isOpen ? 'w-80' : 'w-auto'}`}>
      <div className="flex justify-between items-center mb-2">
        <h3 className="font-bold text-red-400">QA FAST MODE</h3>
        <button onClick={() => setIsOpen(!isOpen)} className="text-gray-400 hover:text-white px-2">
          {isOpen ? 'Minimize' : 'Expand'}
        </button>
      </div>

      {isOpen && (
        <div className="space-y-4 text-sm">
          <div>
            <div className="text-gray-400 mb-1">Simulated Time:</div>
            <div className="font-mono text-lg text-green-400">{currentTime}</div>
          </div>

          <div>
            <div className="text-gray-400 mb-1">Time Multiplier:</div>
            <div className="flex gap-2">
              {[1, 10, 30, 60].map(m => (
                <button 
                  key={m}
                  onClick={() => handleMultiplierChange(m)}
                  className={`px-2 py-1 rounded ${multiplier === m ? 'bg-red-600' : 'bg-gray-700 hover:bg-gray-600'}`}
                >
                  {m}x
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-gray-400 mb-1">Advance Clock:</div>
            <div className="flex gap-2">
              {[1, 5, 30, 60].map(m => (
                <button 
                  key={m}
                  onClick={() => handleAdvance(m)}
                  className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
                >
                  +{m}m
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-gray-400 mb-1">Simulate GPS:</div>
            <div className="flex gap-2">
              <button 
                onClick={() => setGps('INSIDE')}
                className="flex-1 px-2 py-1 rounded bg-blue-600 hover:bg-blue-500"
              >
                INSIDE
              </button>
              <button 
                onClick={() => setGps('OUTSIDE')}
                className="flex-1 px-2 py-1 rounded bg-orange-600 hover:bg-orange-500"
              >
                OUTSIDE
              </button>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-700">
            <button 
              onClick={() => {
                qaTimeService.reset();
                setMultiplier(1);
                locationService.clearQaMockLocation();
              }}
              className="w-full px-2 py-1 rounded bg-red-800 hover:bg-red-700"
            >
              Reset QA Environment
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
