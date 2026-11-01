// SPDX-License-Identifier: MIT
#include "windowchrome.h"
#if !defined(Q_OS_MACOS)
int WindowChrome::leftInset() const { return 0; }
bool WindowChrome::nativeButtons() const { return false; }
void WindowChrome::attach(QWindow *) {}
void WindowChrome::setDark(QWindow *, bool) {}
QVariantMap WindowChrome::metrics(QWindow *) const { return {}; }
#endif
