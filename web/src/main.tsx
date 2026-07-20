import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import { WeatherMap } from './WeatherMap';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WeatherMap />
  </StrictMode>,
);
