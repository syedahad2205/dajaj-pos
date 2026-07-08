/**
 * DAJAJ Finance — React Native App Entry Point
 * @format
 */
import { AppRegistry } from 'react-native';
import App from './src/app/App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
