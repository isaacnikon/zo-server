aact = macro_GetActAttr(22)

adef = macro_GetActAttr(8)

dact = macro_GetDefAttr(22)

ddef = macro_GetDefAttr(8)

macro_SetAAct(aact)

macro_SetADef(adef)

macro_SetDAct(dact)

macro_SetDDef(ddef)

res = ddef - aact

macro_DResult(res)