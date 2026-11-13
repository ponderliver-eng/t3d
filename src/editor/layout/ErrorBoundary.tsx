import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  name: string
  children: ReactNode
}

interface State {
  message: string | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null }

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}]`, error, info)
  }

  render() {
    if (this.state.message) {
      return <div className="ide-panel-unknown">{this.props.name} 出错：{this.state.message}</div>
    }
    return this.props.children
  }
}
