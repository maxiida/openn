import { createBrowserRouter, Navigate } from 'react-router'

import Layout from './_layout'
import MvpHomePage from './mvp-home'
import MvpNodesPage from './mvp-nodes'

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: MvpHomePage },
      { path: 'nodes', Component: MvpNodesPage },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])
