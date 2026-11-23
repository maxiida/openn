import { createBrowserRouter, Navigate } from 'react-router'

import Layout from './_layout'
import MvpCheckPage from './mvp-check'
import MvpHomePage from './mvp-home'
import MvpNodesPage from './mvp-nodes'
import MvpOnboardingPage from './mvp-onboarding'
import MvpSettingsPage from './mvp-settings'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: MvpHomePage },
      { path: 'nodes', Component: MvpNodesPage },
      { path: 'check', Component: MvpCheckPage },
      { path: 'settings', Component: MvpSettingsPage },
      { path: 'welcome', Component: MvpOnboardingPage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
