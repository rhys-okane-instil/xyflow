import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';
import { StoreApi } from 'zustand';

import { getHostForElement, calcAutoPan, getEventPosition } from '../../utils';
import type { OnConnect, HandleType, ReactFlowState } from '../../types';
import { pointToRendererPoint, rendererPointToPoint } from '../../utils/graph';
import {
  ConnectionHandle,
  getClosestHandle,
  getHandleLookup,
  getHandleType,
  isValidHandle,
  resetRecentHandle,
  ValidConnectionFunc,
} from './utils';

export function handlePointerDown({
  event,
  handleId,
  nodeId,
  onConnect,
  isTarget,
  getState,
  setState,
  isValidConnection,
  edgeUpdaterType,
  onEdgeUpdateEnd,
}: {
  event: ReactMouseEvent | ReactTouchEvent;
  handleId: string | null;
  nodeId: string;
  onConnect: OnConnect;
  isTarget: boolean;
  getState: StoreApi<ReactFlowState>['getState'];
  setState: StoreApi<ReactFlowState>['setState'];
  isValidConnection: ValidConnectionFunc;
  edgeUpdaterType?: HandleType;
  onEdgeUpdateEnd?: (evt: MouseEvent | TouchEvent) => void;
}): void {
  // when react-flow is used inside a shadow root we can't use document
  const doc = getHostForElement(event.target as HTMLElement);
  const {
    connectionMode,
    domNode,
    autoPanOnConnect,
    connectionRadius,
    onConnectStart,
    onConnectEnd,
    panBy,
    getNodes,
    cancelConnection,
  } = getState();
  let autoPanId = 0;
  let prevClosestHandle: ConnectionHandle | null;

  const { x, y } = getEventPosition(event);
  const clickedHandle = doc?.elementFromPoint(x, y);
  const handleType = getHandleType(edgeUpdaterType, clickedHandle);
  const containerBounds = domNode?.getBoundingClientRect();

  if (!containerBounds || !handleType) {
    return;
  }

  let prevActiveHandle: Element;
  let connectionPosition = getEventPosition(event, containerBounds);
  let autoPanStarted = false;

  const handleLookup = getHandleLookup({
    nodes: getNodes(),
    nodeId,
    handleId,
    handleType,
  });

  // when the user is moving the mouse close to the edge of the canvas while connecting we move the canvas
  const autoPan = (): void => {
    if (!autoPanOnConnect) {
      return;
    }
    const [xMovement, yMovement] = calcAutoPan(connectionPosition, containerBounds);

    panBy({ x: xMovement, y: yMovement });
    autoPanId = requestAnimationFrame(autoPan);
  };

  setState({
    connectionPosition,
    connectionNodeId: nodeId,
    connectionHandleId: handleId,
    connectionHandleType: handleType,
  });

  onConnectStart?.(event, { nodeId, handleId, handleType });

  function onPointerMove(event: MouseEvent | TouchEvent) {
    const { transform } = getState();
    connectionPosition = getEventPosition(event, containerBounds);

    prevClosestHandle = getClosestHandle(
      pointToRendererPoint(connectionPosition, transform, false, [1, 1]),
      connectionRadius,
      handleLookup
    );

    if (!autoPanStarted) {
      autoPan();
      autoPanStarted = true;
    }

    setState({
      connectionPosition: prevClosestHandle
        ? rendererPointToPoint(
            {
              x: prevClosestHandle.x,
              y: prevClosestHandle.y,
            },
            transform
          )
        : connectionPosition,
    });

    if (!prevClosestHandle) {
      return resetRecentHandle(prevActiveHandle);
    }

    const { connection, handleDomNode, isValid } = isValidHandle(
      event,
      prevClosestHandle,
      connectionMode,
      nodeId,
      handleId,
      isTarget ? 'target' : 'source',
      isValidConnection,
      doc
    );

    if (connection.source !== connection.target && handleDomNode) {
      resetRecentHandle(prevActiveHandle);
      prevActiveHandle = handleDomNode;
      handleDomNode.classList.add('react-flow__handle-connecting');
      handleDomNode.classList.toggle('react-flow__handle-valid', isValid);
    }
  }

  function onPointerUp(event: MouseEvent | TouchEvent) {
    cancelAnimationFrame(autoPanId);
    autoPanStarted = false;

    if (prevClosestHandle) {
      const { connection, isValid } = isValidHandle(
        event,
        prevClosestHandle,
        connectionMode,
        nodeId,
        handleId,
        isTarget ? 'target' : 'source',
        isValidConnection,
        doc
      );

      if (isValid) {
        onConnect?.(connection);
      }
    }

    onConnectEnd?.(event);

    if (edgeUpdaterType) {
      onEdgeUpdateEnd?.(event);
    }

    resetRecentHandle(prevActiveHandle);

    cancelConnection();

    doc.removeEventListener('mousemove', onPointerMove as EventListener);
    doc.removeEventListener('mouseup', onPointerUp as EventListener);

    doc.removeEventListener('touchmove', onPointerMove as EventListener);
    doc.removeEventListener('touchend', onPointerUp as EventListener);
  }

  doc.addEventListener('mousemove', onPointerMove as EventListener);
  doc.addEventListener('mouseup', onPointerUp as EventListener);

  doc.addEventListener('touchmove', onPointerMove as EventListener);
  doc.addEventListener('touchend', onPointerUp as EventListener);
}
