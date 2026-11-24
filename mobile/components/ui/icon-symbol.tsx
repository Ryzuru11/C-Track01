// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { SymbolView, SymbolWeight, SymbolViewProps } from 'expo-symbols';
import { ComponentProps } from 'react';
import { OpaqueColorValue, Platform, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

type MaterialIconName = ComponentProps<typeof MaterialIcons>['name'];
type IconSymbolName = keyof typeof MAPPING;

/**
 * Add your SF Symbols to Material Icons mappings here.
 * - see Material Icons in the [Icons Directory](https://icons.expo.fyi).
 * - see SF Symbols in the [SF Symbols](https://developer.apple.com/sf-symbols/) app.
 */
const MAPPING = {
  // Navigation icons
  'house.fill': 'home',
  'house': 'home',
  'clipboard.fill': 'assignment',
  'clipboard': 'assignment',
  'person.fill': 'person',
  'person': 'person',
  'chart.bar.fill': 'bar-chart',
  'chart.bar': 'bar-chart',
  'clock.fill': 'schedule',
  'clock': 'schedule',
  'square.grid.2x2.fill': 'apps',
  'square.grid.2x2': 'apps',
  
  // Action icons
  'paperplane.fill': 'send',
  'paperplane': 'send',
  'plus': 'add',
  'plus.circle.fill': 'add-circle',
  'plus.circle': 'add-circle-outline',
  'bell.fill': 'notifications',
  'bell': 'notifications-none',
  'gearshape.fill': 'settings',
  'gearshape': 'settings',
  'camera.fill': 'camera-alt',
  'camera': 'camera-alt',
  
  // Navigation arrows
  'chevron.left.forwardslash.chevron.right': 'code',
  'chevron.right': 'chevron-right',
  'chevron.left': 'chevron-left',
  'chevron.down': 'expand-more',
  'chevron.up': 'expand-less',
  'arrow.right': 'arrow-forward',
  'arrow.left': 'arrow-back',
  'arrow.up': 'arrow-upward',
  'arrow.down': 'arrow-downward',
  'arrow.right.circle.fill': 'arrow-circle-right',
  'arrow.right.circle': 'arrow-circle-right',
  'arrow.right.square.fill': 'exit-to-app',
  'arrow.right.square': 'exit-to-app',
  'arrow.up.right.square.fill': 'open-in-new',
  'arrow.up.right.square': 'open-in-new',
  'arrow.left.circle.fill': 'arrow-back',
  'arrow.left.circle': 'arrow-back',
  
  // Location and status
  'location.fill': 'location-on',
  'location': 'location-on',
  'mappin.circle.fill': 'place',
  'mappin.circle': 'place',
  'mappin': 'place',
  'mappin.and.ellipse': 'place',
  'calendar.circle.fill': 'date-range',
  'checkmark.circle.fill': 'check-circle',
  'checkmark.circle': 'check-circle-outline',
  'checkmark': 'check',
  'xmark.circle.fill': 'cancel',
  'xmark.circle': 'cancel',
  'xmark': 'close',
  'exclamationmark.triangle.fill': 'warning',
  'exclamationmark.triangle': 'warning',
  'info.circle.fill': 'info',
  'info.circle': 'info',
  'questionmark.circle.fill': 'help',
  'questionmark.circle': 'help-outline',
  
  // Document and file
  'doc.text.fill': 'description',
  'doc.text': 'description',
  'doc.on.doc': 'content-copy',
  'briefcase.fill': 'work',
  'briefcase': 'work',
  'folder.fill': 'folder',
  'folder': 'folder',
  'tray.fill': 'inbox',
  'tray': 'inbox',
  'square.and.arrow.up': 'share',
  
  // Communication
  'envelope.fill': 'email',
  'envelope': 'email',
  'phone.fill': 'phone',
  'phone': 'phone',
  'message.fill': 'message',
  'message': 'message',
  
  // Media and view
  'photo.fill': 'photo',
  'photo': 'photo',
  'photo.fill.on.rectangle.fill': 'collections',
  'play.fill': 'play-arrow',
  'play': 'play-arrow',
  'pause.fill': 'pause',
  'pause': 'pause',
  'eye.fill': 'visibility',
  'eye': 'visibility',
  'eye.slash.fill': 'visibility-off',
  'building.2.fill': 'business',
  'circle.fill': 'circle',
  'arrow.counterclockwise': 'refresh',
  'exclamationmark.circle.fill': 'error',
  'timer': 'timer',
  'bolt.fill': 'bolt',
  
  // Filter and sort
  'line.3.horizontal.decrease.circle': 'filter-list',
  
  // Other
  'moon.fill': 'nightlight',
  'moon': 'nightlight',
  'sun.max.fill': 'wb-sunny',
  'sun.max': 'wb-sunny',
  'shield.fill': 'security',
  'shield': 'security',
  'globe': 'language',
  'star.fill': 'star',
  'star': 'star-border',
  'heart.fill': 'favorite',
  'heart': 'favorite-border',
  'trash.fill': 'delete',
  'trash': 'delete',
  'pencil': 'edit',
  'magnifyingglass': 'search',
  'ellipsis': 'more-vert',
  'calendar': 'event',
  'lock.fill': 'lock',
  'lock': 'lock',
  // Map and tracking
  'scope': 'gps-fixed',
  'figure.walk': 'directions-walk',
  'map.fill': 'map',
  'map': 'map',
  'ruler': 'straighten',
  'location.north.fill': 'navigation',
  'chart.line.uptrend.xyaxis': 'trending-up',
} satisfies Record<string, MaterialIconName>;

/**
 * An icon component that uses native SF Symbols on iOS, and Material Icons on Android and web.
 * This ensures a consistent look across platforms, and optimal resource usage.
 * Icon `name`s are based on SF Symbols and require manual mapping to Material Icons.
 */
export function IconSymbol({
  name,
  size = 24,
  color,
  style,
  weight = 'regular',
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<ViewStyle | TextStyle>;
  weight?: SymbolWeight;
}) {
  // Use native SF Symbols on iOS, Material Icons on Android/Web
  if (Platform.OS === 'ios') {
    return (
      <SymbolView
        name={name as SymbolViewProps['name']}
        size={size}
        tintColor={color}
        weight={weight}
        style={style as StyleProp<ViewStyle>}
      />
    );
  }
  
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style as StyleProp<TextStyle>} />;
}
