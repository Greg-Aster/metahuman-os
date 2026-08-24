import React from 'react'
import ReactTestRenderer from 'react-test-renderer'
import nodejs from 'nodejs-mobile-react-native'
import App from '../App'

jest.mock('nodejs-mobile-react-native', () => ({
  channel: {
    addListener: jest.fn(),
    removeListener: jest.fn(),
    send: jest.fn(),
  },
  start: jest.fn(),
}))

jest.mock('react-native-webview', () => {
  const ReactModule = require('react')
  const {View} = require('react-native')

  return {
    WebView: ReactModule.forwardRef((props: object, ref: React.Ref<unknown>) => (
      <View ref={ref} {...props} />
    )),
  }
})

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react')

  const Container = ({children}: React.PropsWithChildren) => (
    <ReactModule.Fragment>{children}</ReactModule.Fragment>
  )

  return {
    SafeAreaProvider: Container,
    SafeAreaView: Container,
  }
})

jest.mock('@react-native-voice/voice', () => ({
  __esModule: true,
  default: {
    cancel: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    isAvailable: jest.fn().mockResolvedValue(true),
    removeAllListeners: jest.fn(),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  },
}))

test('owns the embedded backend lifecycle', async () => {
  let renderer: ReactTestRenderer.ReactTestRenderer

  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<App />)
  })

  expect(nodejs.start).toHaveBeenCalledWith('main.js')
  expect(nodejs.channel.addListener).toHaveBeenCalledWith(
    'message',
    expect.any(Function),
  )

  ReactTestRenderer.act(() => renderer.unmount())

  expect(nodejs.channel.removeListener).toHaveBeenCalledWith(
    'message',
    expect.any(Function),
  )
})
